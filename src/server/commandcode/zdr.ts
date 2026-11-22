/**
 * Zero-data-retention opt-in for Command Code requests, carried as `x-cmd-zdr: 1`.
 *
 * Pi Pocket sends it on every Provider API request by default; `commandcode.enableZDR` in Pi's `settings.json` (written
 * by `/commandcode-zdr`) turns it off or back on, and the environment decides first, so a shell export cannot be
 * silently weakened by the settings file: `CMD_ZDR=1` (or its `COMMANDCODE_ZDR` alias) turns it on, `=0` turns it off.
 * The Go plan's `/alpha/generate` fallback is Command Code's own endpoint, not the Provider API: it gets no such header.
 *
 * Vendored from `patlux/pi-commandcode-provider` 0.8.7 `src/zdr.ts`, whose settings file is read and written the same
 * way (a symlink updated through its target, a malformed file never overwritten, an atomic write that only the owner
 * reads). Upstream is off until asked for; Pi Pocket's default is on, which `resolveZdr` reports as `default`.
 */
import { randomUUID } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** The top-level section of `settings.json` this provider owns. */
export const ZDR_SETTINGS_SECTION = "commandcode";
export const ZDR_SETTING_KEY = "enableZDR";

/** Where the answer came from: Pi Pocket's default, `settings.json`, or the environment. */
export type ZdrSource = "default" | "settings" | "env";
export type ZdrEnvVar = "CMD_ZDR" | "COMMANDCODE_ZDR";

export interface ZdrState {
    enabled: boolean;
    source: ZdrSource;
    /** The environment variable that decided, when `source` is `env`. */
    envVar?: ZdrEnvVar;
}

type Environment = Record<string, string | undefined>;

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The host's own settings parser tolerates a leading UTF-8 BOM, so both the reader and the writer do too: a BOM must
 * not silently drop a saved opt-in.
 */
function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** `true` or `false` when the settings say, `undefined` when they leave it to Pi Pocket's default. */
export function readZdrSetting(settings: unknown): boolean | undefined {
    if (!isRecord(settings)) {
        return undefined;
    }

    const section = settings[ZDR_SETTINGS_SECTION];
    const value = isRecord(section) ? section[ZDR_SETTING_KEY] : undefined;

    // Only a literal boolean counts, so a typo cannot silently weaken privacy.
    return typeof value === "boolean" ? value : undefined;
}

/**
 * The variable that decides, named so the command can tell people which one to unset. `CMD_ZDR` is the documented
 * name and the legacy alias stays supported; an explicit opt-out wins over an opt-in.
 */
export function zdrEnvVar(env: Environment = process.env): ZdrEnvVar | undefined {
    if (env.CMD_ZDR === "0") {
        return "CMD_ZDR";
    }

    if (env.COMMANDCODE_ZDR === "0") {
        return "COMMANDCODE_ZDR";
    }

    if (env.CMD_ZDR === "1") {
        return "CMD_ZDR";
    }

    if (env.COMMANDCODE_ZDR === "1") {
        return "COMMANDCODE_ZDR";
    }

    return undefined;
}

/** The environment wins; then the settings file; then Pi Pocket's default, which is on. */
export function resolveZdr(settings: unknown, env: Environment = process.env): ZdrState {
    const envVar = zdrEnvVar(env);

    if (envVar !== undefined) {
        return { enabled: env[envVar] !== "0", source: "env", envVar };
    }

    const setting = readZdrSetting(settings);

    if (setting !== undefined) {
        return { enabled: setting, source: "settings" };
    }

    return { enabled: true, source: "default" };
}

/** Pi Pocket's default answer, for code that only asks whether the header goes out. */
export function zdrEnabled(env: Environment = process.env): boolean {
    return resolveZdr(undefined, env).enabled;
}

/**
 * Read the opt-in from the agent settings file itself. The opt-in is owned by the file `saveZdrSetting` writes, so a
 * project settings override cannot silently turn it off (or on). A missing or unreadable file is Pi Pocket's default;
 * a malformed file is left for the write path to report rather than failing the provider load.
 */
export async function loadZdrSettings(path: string): Promise<unknown> {
    try {
        return JSON.parse(stripBom(await readFile(path, "utf8")));
    } catch {
        return undefined;
    }
}

export function zdrHeaders(state: ZdrState): Record<string, string> | undefined {
    return state.enabled ? { "x-cmd-zdr": "1" } : undefined;
}

export function describeZdr(state: ZdrState, settingsPath = "settings.json"): string {
    if (state.source === "env") {
        return `${state.enabled ? "on" : "off"} (${state.envVar ?? "environment"})`;
    }

    if (state.source === "settings") {
        return `${state.enabled ? "on" : "off"} (${settingsPath} commandcode.enableZDR)`;
    }

    return `${state.enabled ? "on" : "off"} (default)`;
}

/**
 * A symlinked settings.json (e.g. a managed file) is updated through its target so the link survives; a dangling link
 * is refused rather than replaced.
 */
async function resolveSettingsTarget(path: string): Promise<string> {
    try {
        return await realpath(path);
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw new Error(
                "Could not read settings.json in the agent directory; check file permissions",
            );
        }
    }

    const entry = await lstat(path).catch(() => undefined);

    if (entry?.isSymbolicLink()) {
        throw new Error(
            "settings.json is a symlink to a missing file; refusing to replace the link",
        );
    }

    return path;
}

/**
 * Persist the opt-in into the agent settings file, preserving every other key, and answer the written settings so the
 * caller resolves the effective state without waiting for a reload. The host re-reads the file and merges only the
 * fields it changed on each of its own saves, so this key survives later host writes; writes from separate processes
 * are not coordinated. A malformed file is never overwritten, and an unreadable file is reported instead of replaced.
 */
export async function saveZdrSetting(settingsPath: string, enabled: boolean): Promise<unknown> {
    const path = await resolveSettingsTarget(settingsPath);
    let raw: string | undefined;

    try {
        raw = await readFile(path, "utf8");
    } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
            throw new Error(
                "Could not read settings.json in the agent directory; check file permissions",
            );
        }
    }

    let settings: Record<string, unknown> = {};
    const text = raw === undefined ? undefined : stripBom(raw);

    if (text !== undefined && text.trim() !== "") {
        let parsed: unknown;

        try {
            parsed = JSON.parse(text);
        } catch {
            throw new Error(
                "Invalid settings.json in the agent directory; refusing to overwrite it. Fix the JSON or set commandcode.enableZDR by hand.",
            );
        }

        if (!isRecord(parsed)) {
            throw new Error("settings.json must contain a JSON object; refusing to overwrite it");
        }

        settings = { ...parsed };
    }

    const section = settings[ZDR_SETTINGS_SECTION];

    settings[ZDR_SETTINGS_SECTION] = {
        ...(isRecord(section) ? section : {}),
        [ZDR_SETTING_KEY]: enabled,
    };

    const temporary = `${path}.${randomUUID()}.tmp`;

    try {
        await mkdir(dirname(path), { recursive: true });
        await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, {
            encoding: "utf8",
            mode: 0o600,
            flag: "wx",
        });
        await rename(temporary, path);
    } catch {
        throw new Error(
            "Could not save settings.json in the agent directory; check file permissions",
        );
    } finally {
        // Cleanup must not replace the sanitized error with an OS message containing local paths.
        await rm(temporary, { force: true }).catch(() => {});
    }

    return settings;
}
