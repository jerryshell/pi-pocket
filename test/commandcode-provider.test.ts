// The vendored Command Code provider's own units (`src/server/commandcode/`): the sign-in callback's origin and
// state, how a pasted key is validated, where credentials are read, the catalog's model facts, and its prices.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { getConfiguredApiKey } from "../src/server/commandcode/api-key.ts";
import { startAuthServer } from "../src/server/commandcode/auth-server.ts";
import {
    refreshToken,
    validateApiKey,
    validationApiBase,
} from "../src/server/commandcode/oauth.ts";
import {
    commandCodeModelsFromApiResponse,
    inputModalitiesForModel,
    MODEL_EFFORTS,
    MODEL_MAX_OUTPUT_TOKENS,
    MODEL_REASONING,
    thinkingMetadataForModel,
} from "../src/server/commandcode/models.ts";
import { MODEL_COSTS, PRICING_LAST_VERIFIED } from "../src/server/commandcode/pricing.ts";
import {
    loadZdrSettings,
    resolveZdr,
    saveZdrSetting,
    zdrEnabled,
    zdrHeaders,
} from "../src/server/commandcode/zdr.ts";

const folders: string[] = [];

function tempFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), "pi-pocket-commandcode-"));

    folders.push(folder);

    return folder;
}

after(() => {
    for (const folder of folders) {
        rmSync(folder, { force: true, recursive: true });
    }
});

/** An auth file as pi writes it: {"commandcode": {"type": "api", "key": "..."}}. */
function writeCredentials(path: string, key: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ commandcode: { type: "api", key } }));
}

interface Asked {
    url: string;
    authorization: string | undefined;
}

/** A fetch that answers at once, and remembers what it was asked. */
function answer(status: number, asked: Asked[]): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);

        asked.push({
            url: String(input),
            authorization: headers.get("authorization") ?? undefined,
        });

        return new Response("{}", { status });
    }) as unknown as typeof fetch;
}

async function post(port: number, body: unknown, origin?: string): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(origin === undefined ? {} : { Origin: origin }),
        },
        body: JSON.stringify(body),
    });

    await response.arrayBuffer();

    return response.status;
}

function close(auth: { server: { listening: boolean; close: () => unknown } }): void {
    if (auth.server.listening) {
        auth.server.close();
    }
}

test("the prices carry the free tier's zero rates, the dated Ling preview's list rates, and the ultrafast model's single rate", () => {
    assert.equal(PRICING_LAST_VERIFIED, "2026-11-20");
    assert.deepEqual(MODEL_COSTS["recursive/flint-v1.0:free"], {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    });
    assert.deepEqual(MODEL_COSTS["tencent/hy4-flash"], {
        input: 0.07,
        output: 0.281,
        cacheRead: 0.003,
        cacheWrite: 0,
    });
    assert.deepEqual(MODEL_COSTS["Qwen/Qwen4-Max"], {
        input: 1.5,
        output: 4.5,
        cacheRead: 0.075,
        cacheWrite: 1.875,
    });
    assert.deepEqual(MODEL_COSTS["thinkingmachines/inkling-2-small:free"], {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    });
    assert.equal(
        MODEL_COSTS["stealth/crouton-alpha"],
        undefined,
        "the retired stealth preview is gone",
    );
    assert.deepEqual(MODEL_COSTS["inclusionai/ling-3.1-flash-1019"], {
        input: 0.3,
        output: 0.9,
        cacheRead: 0.06,
        cacheWrite: 0,
    });
    assert.equal(
        MODEL_COSTS["inclusionai/ling-3.1-flash-1019:free"],
        undefined,
        "the retired free entry is gone",
    );
    assert.deepEqual(MODEL_COSTS["deepseek/deepseek-v4.1-flash-ultrafast"], {
        input: 2.4,
        output: 9.6,
        cacheRead: 0.048,
        cacheWrite: 0,
    });
    assert.equal(
        MODEL_COSTS["poolside/laguna-s-2.1-free"],
        undefined,
        "the retired free poolside entry is gone",
    );
    assert.deepEqual(MODEL_COSTS["tencent/hy4"], {
        input: 0.834,
        output: 2.501,
        cacheRead: 0.042,
        cacheWrite: 0,
    });
    assert.deepEqual(MODEL_COSTS["google/gemini-4-neon"], {
        input: 3,
        output: 15,
        cacheRead: 0.15,
        cacheWrite: 0,
    });
    assert.deepEqual(MODEL_COSTS["gpt-6.2-sol"], {
        input: 2,
        output: 10,
        cacheRead: 0.1,
        cacheWrite: 2.5,
        tiers: [{ inputTokensAbove: 272_000, input: 4, output: 15, cacheRead: 0.2, cacheWrite: 5 }],
    });
    assert.deepEqual(MODEL_COSTS["gpt-6.2-astra"], {
        input: 8,
        output: 40,
        cacheRead: 0.4,
        cacheWrite: 10,
        tiers: [
            { inputTokensAbove: 272_000, input: 16, output: 60, cacheRead: 0.8, cacheWrite: 20 },
        ],
    });
});

test("the CLI 1.91.1 catalog adds GPT-6.2 Astra and Sol, and Hy4, with their own facts", () => {
    const added = [
        {
            id: "gpt-6.2-astra",
            input: ["text", "image"],
            efforts: ["low", "medium", "high", "xhigh", "max"],
        },
        {
            id: "gpt-6.2-sol",
            input: ["text", "image"],
            efforts: ["low", "medium", "high", "xhigh", "max"],
        },
        { id: "tencent/hy4", input: ["text", "image"], efforts: ["low", "medium", "high"] },
    ];

    for (const { id, input, efforts } of added) {
        assert.deepEqual(inputModalitiesForModel(id), input);
        assert.equal(MODEL_REASONING[id], true);
        assert.deepEqual(MODEL_EFFORTS[id], efforts);
        assert.deepEqual(thinkingMetadataForModel(id)?.thinking?.efforts, efforts);
        assert.ok(thinkingMetadataForModel(id), "reasoning metadata is registered");
        assert.equal(MODEL_MAX_OUTPUT_TOKENS[id], undefined, "the default output limit applies");

        const models = commandCodeModelsFromApiResponse({
            object: "list",
            data: [
                {
                    id,
                    name: id,
                    context_length: 1_000_000,
                    supported_endpoints: ["/chat/completions", "/responses"],
                },
            ],
        });

        assert.equal(models[0]?.api, "openai-responses", "the API advertises Responses");
        assert.equal(models[0]?.maxTokens, 65_536);
    }
});

test("zero data retention is on by default, and off only when the owner says so", () => {
    assert.equal(zdrEnabled({}), true);
    assert.equal(zdrEnabled({ CMD_ZDR: "1" }), true, "the old opt-in still means on");
    assert.equal(zdrEnabled({ CMD_ZDR: "0" }), false);
    assert.equal(zdrEnabled({ COMMANDCODE_ZDR: "0" }), false);
    assert.equal(
        zdrEnabled({ CMD_ZDR: "1", COMMANDCODE_ZDR: "0" }),
        false,
        "the explicit opt-out wins",
    );

    assert.deepEqual(resolveZdr(undefined, {}), { enabled: true, source: "default" });
    assert.deepEqual(resolveZdr({ commandcode: { enableZDR: false } }, {}), {
        enabled: false,
        source: "settings",
    });
    assert.deepEqual(resolveZdr({ commandcode: { enableZDR: true } }, {}), {
        enabled: true,
        source: "settings",
    });
    assert.deepEqual(
        resolveZdr({ commandcode: { enableZDR: true } }, { CMD_ZDR: "0" }),
        { enabled: false, source: "env", envVar: "CMD_ZDR" },
        "a shell export cannot be weakened by a settings file",
    );
    assert.equal(
        resolveZdr({ commandcode: { enableZDR: "no" } }, {}).source,
        "default",
        "only a literal boolean counts",
    );
    assert.deepEqual(zdrHeaders({ enabled: true, source: "default" }), { "x-cmd-zdr": "1" });
    assert.equal(zdrHeaders({ enabled: false, source: "settings" }), undefined);
});

test("the opt-in is written to Pi's settings file, and its other keys stay", async () => {
    const folder = tempFolder();
    const path = join(folder, "settings.json");

    writeFileSync(path, JSON.stringify({ theme: "dark", commandcode: { other: 1 } }), {
        mode: 0o600,
    });

    const written = await saveZdrSetting(path, false);

    assert.deepEqual(written, { theme: "dark", commandcode: { other: 1, enableZDR: false } });
    assert.deepEqual(await loadZdrSettings(path), written);
    assert.deepEqual(resolveZdr(await loadZdrSettings(path), {}), {
        enabled: false,
        source: "settings",
    });
    assert.equal(
        (statSync(path).mode & 0o777).toString(8),
        "600",
        "the file keeps the owner's permissions",
    );

    // A malformed file is never overwritten: someone else's broken JSON stays for them to fix.
    writeFileSync(path, "{ not json");
    await assert.rejects(() => saveZdrSetting(path, true), /refusing to overwrite/);
    assert.equal(readFileSync(path, "utf8"), "{ not json");

    // A missing file is made, with a leading BOM read through as the host's own parser does.
    const fresh = join(folder, "fresh", "settings.json");

    await saveZdrSetting(fresh, true);
    writeFileSync(fresh, `\uFEFF${readFileSync(fresh, "utf8")}`);
    assert.deepEqual(resolveZdr(await loadZdrSettings(fresh), {}), {
        enabled: true,
        source: "settings",
    });
});

test("credentials come from the pi profile the environment names, and not from the default one", () => {
    const home = tempFolder();
    const profile = join(home, "profile");

    writeCredentials(join(home, ".pi", "agent", "auth.json"), "default-profile");
    writeCredentials(join(profile, "auth.json"), "named-profile");

    assert.equal(
        getConfiguredApiKey({ env: { PI_CODING_AGENT_DIR: profile }, homeDir: () => home }),
        "named-profile",
    );
    assert.equal(
        getConfiguredApiKey({
            env: { PI_CODING_AGENT_DIR: join(home, "empty") },
            homeDir: () => home,
        }),
        undefined,
        "a named profile does not fall back to another profile's key",
    );
    assert.equal(getConfiguredApiKey({ env: {}, homeDir: () => home }), "default-profile");
});

test("the Command Code CLI's own credentials still resolve from the home folder", () => {
    const home = tempFolder();

    writeCredentials(join(home, ".pi", "agent", "auth.json"), "default-profile");
    writeCredentials(join(home, ".commandcode", "auth.json"), "cli-profile");

    assert.equal(
        getConfiguredApiKey({
            env: { PI_CODING_AGENT_DIR: join(home, "empty") },
            homeDir: () => home,
        }),
        "cli-profile",
    );
});

test("key validation goes to the base beside the configured Provider API base", () => {
    assert.equal(
        validationApiBase({ COMMANDCODE_API_BASE: "https://gateway.example/provider/v1" }),
        "https://gateway.example",
    );
    assert.equal(
        validationApiBase({ COMMANDCODE_API_BASE: "https://gateway.example/provider/v1/" }),
        "https://gateway.example",
    );
    assert.equal(validationApiBase({}), "https://api.commandcode.ai");
});

test("a pasted key is validated against the configured base, with the key", async () => {
    const asked: Asked[] = [];
    const previous = process.env.COMMANDCODE_API_BASE;

    process.env.COMMANDCODE_API_BASE = "https://gateway.example/provider/v1";

    try {
        await validateApiKey("user_abc", { fetchImpl: answer(200, asked) });
    } finally {
        if (previous === undefined) {
            delete process.env.COMMANDCODE_API_BASE;
        } else {
            process.env.COMMANDCODE_API_BASE = previous;
        }
    }

    assert.deepEqual(asked, [
        { url: "https://gateway.example/alpha/whoami", authorization: "Bearer user_abc" },
    ]);
});

test("a key the account no longer holds is reported as invalid", async () => {
    await assert.rejects(validateApiKey("user_stale", { fetchImpl: answer(401, []) }), {
        message: "Invalid Command Code API key",
    });
});

test("a whoami that stalls stops at the deadline, even when fetch ignores the abort", async () => {
    const stalled = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const started = Date.now();

    await assert.rejects(validateApiKey("user_abc", { fetchImpl: stalled, timeoutMs: 20 }), {
        message: "Could not validate the Command Code API key: request timed out after 20ms",
    });
    assert.ok(Date.now() - started < 5_000, "the deadline ends the wait");
});

test("a refresh checks the stored key first, then returns it with a new expiry", async () => {
    const asked: Asked[] = [];
    const expired = { refresh: "user_abc", access: "user_abc", expires: Date.now() - 1_000 };
    const refreshed = await refreshToken(expired, undefined, { fetchImpl: answer(200, asked) });

    assert.deepEqual(asked, [
        { url: "https://api.commandcode.ai/alpha/whoami", authorization: "Bearer user_abc" },
    ]);
    assert.equal(refreshed.access, "user_abc");
    assert.equal(refreshed.refresh, "user_abc");
    assert.ok(refreshed.expires > Date.now(), "the expiry moves into the future");
});

test("a refresh of a revoked key fails with 401 invalid_token, as Oh My Pi signs it out on", async () => {
    await assert.rejects(
        refreshToken({ refresh: "user_stale", access: "user_stale", expires: 0 }, undefined, {
            fetchImpl: answer(401, []),
        }),
        (error: unknown) =>
            error instanceof Error &&
            /\b401\b/.test(error.message) &&
            /invalid_token/.test(error.message),
    );
});

test("a refresh fails without those words when whoami is down, so the key is not signed out", async () => {
    await assert.rejects(
        refreshToken({ refresh: "user_abc", access: "user_abc", expires: 0 }, undefined, {
            fetchImpl: answer(503, []),
        }),
        (error: unknown) => error instanceof Error && !/\b401\b|invalid_token/.test(error.message),
    );
});

test("a cancelled refresh stops the probe, and still says neither 401 nor invalid_token", async () => {
    const host = new AbortController();
    let probe: AbortSignal | undefined;
    const refresh = refreshToken(
        { refresh: "user_abc", access: "user_abc", expires: 0 },
        host.signal,
        {
            fetchImpl: ((_input: unknown, init?: RequestInit) => {
                probe = init?.signal ?? undefined;

                return new Promise<Response>(() => {});
            }) as unknown as typeof fetch,
        },
    );

    host.abort();
    await assert.rejects(
        refresh,
        (error: unknown) => error instanceof Error && !/\b401\b|invalid_token/.test(error.message),
    );
    assert.equal(probe?.aborted, true, "the probe it already started was aborted");

    await assert.rejects(
        refreshToken({ refresh: "user_abc", access: "user_abc", expires: 0 }, AbortSignal.abort(), {
            fetchImpl: answer(200, []),
        }),
        (error: unknown) => error instanceof Error && !/\b401\b|invalid_token/.test(error.message),
    );
});

test("the callback refuses a local development origin", async () => {
    const auth = await startAuthServer({ startPort: 0, expectedState: "state-1" });

    auth.waitForCallback.catch(() => {});

    try {
        assert.equal(
            await post(
                auth.port,
                { state: "state-1", error: "access_denied" },
                "http://localhost:3000",
            ),
            403,
        );
    } finally {
        close(auth);
    }
});

test("only the callback that holds the state token settles the sign-in", async () => {
    const auth = await startAuthServer({ startPort: 0, expectedState: "state-2" });
    let settled = false;

    auth.waitForCallback.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        },
    );

    try {
        assert.equal(
            await post(auth.port, { state: "spoofed", error: "access_denied" }),
            403,
            "an error from another page is refused",
        );
        assert.equal(settled, false, "and leaves the sign-in waiting");

        assert.equal(
            await post(auth.port, {
                state: "state-2",
                apiKey: "user_key",
                userId: "user-1",
                userName: "Owner",
                keyName: "laptop",
            }),
            200,
        );

        const callback = await auth.waitForCallback;

        assert.deepEqual(callback, {
            apiKey: "user_key",
            state: "state-2",
            userId: "user-1",
            userName: "Owner",
            keyName: "laptop",
        });
    } finally {
        close(auth);
    }
});
