/**
 * Command Code: its Provider API as a model provider, with a browser or API-key sign-in, the live model catalog, and
 * `/commandcode-quota` for the account's credits and usage windows.
 *
 * Vendored from `patlux/pi-commandcode-provider` (`src/server/commandcode/`): the catalog, its cache, the sign-in,
 * and the account's endpoints. Streaming goes through Pi's own OpenAI Chat Completions, OpenAI Responses, and
 * Anthropic Messages transports, which the catalog chooses for each model.
 */
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { getConfiguredApiKey } from "../commandcode/api-key.ts";
import {
    baseUrlForModel,
    DEFAULT_MODELS_URL,
    DEFAULT_PROVIDER_API_BASE,
    getModelsTimeoutMs,
    inputModalitiesForModel,
    loadCachedCommandCodeModels,
    loadCommandCodeModels,
    MODEL_EFFORTS,
    thinkingMetadataForModel,
    type CommandCodeModel,
} from "../commandcode/models.ts";
import {
    browserLogin,
    credentialsFromApiKey,
    getApiKey,
    refreshToken,
    sanitizeApiKey,
    validateApiKey,
    type OAuthCredentials,
} from "../commandcode/oauth.ts";
import { MODEL_COSTS, ZERO_MODEL_COST } from "../commandcode/pricing.ts";
import { formatQuota } from "../commandcode/quota-format.ts";
import { fetchCommandCodeQuota, redactValue } from "../commandcode/quota.ts";
import type { CommandCodeQuota, CommandCodeQuotaResult } from "../commandcode/quota-types.ts";
import type { ExtensionWeb, PocketHost, WebRequest } from "../host.ts";

/** A chat model's config: the union `models` takes narrows to this one by its required `reasoning`. */
type ChatModelConfig = Extract<
    NonNullable<ProviderConfig["models"]>[number],
    { reasoning: boolean }
>;
type OAuthLogin = Parameters<NonNullable<ProviderConfig["oauth"]>["login"]>[0];

/** How long one answer of the account's endpoints serves the menu and the sheet. */
const QUOTA_FRESH_MS = 30_000;

/** What the menu's hint and the sheet read: the numbers, for the browser to format. */
interface UsageView {
    at: number;
    remaining: number;
    spent: number;
    pool: number;
    percent: number;
    plan: string | null;
    periodEnd: string | null;
    windows: {
        id: "fiveHour" | "weekly";
        used: number;
        cap: number;
        percent: number;
        resetAt: number | null;
    }[];
    unavailable: string[];
}

/** The provider's base URL without its provider path: the account's own endpoints sit beside it. */
function accountApiBase(providerApiBase: string): string {
    return providerApiBase.replace(/\/provider\/v1\/?$/, "");
}

/** Command Code's headers: zero-data-retention when the owner asked for it (`CMD_ZDR=1`). */
function commandCodeHeaders(): Record<string, string> | undefined {
    return process.env.CMD_ZDR === "1" || process.env.COMMANDCODE_ZDR === "1"
        ? { "x-cmd-zdr": "1" }
        : undefined;
}

/**
 * How each wire differs from Pi's defaults. Chat Completions leaves out the OpenAI extras Command Code does not
 * advertise; Responses keeps Pi's defaults and only mutes what the service lacks; Anthropic keeps its Claude tuning.
 */
function compatForModel(model: CommandCodeModel): ChatModelConfig["compat"] {
    if (model.api === "openai-responses") {
        return {
            supportsDeveloperRole: false,
            supportsLongCacheRetention: false,
            sessionAffinityFormat: "openai-nosession",
        };
    }

    if (model.api === "anthropic-messages") {
        return {
            supportsEagerToolInputStreaming: false,
            supportsLongCacheRetention: false,
            supportsCacheControlOnTools: false,
            ...(model.reasoning ? { forceAdaptiveThinking: true } : {}),
        };
    }

    return {
        supportsStore: false,
        supportsDeveloperRole: false,
        supportsReasoningEffort: MODEL_EFFORTS[model.id] !== undefined,
        maxTokensField: "max_tokens",
    };
}

/** The ids whose models are free for now: a `:free` or `-free` id, which shares its name with the paid one. */
const FREE = /(?:^|[:/-])free$/;

/** The catalog's name without the provider's own "(CC)", and marked "(Free)" where the id is. */
function displayName(model: CommandCodeModel): string {
    const name = model.name.replace(/ \(CC\)$/, "");

    return FREE.test(model.id) ? `${name} (Free)` : name;
}

/** One model as Pi's runtime takes it: its wire, limits, image input, thinking levels, and display price. */
function modelConfig(model: CommandCodeModel, apiBase: string): ChatModelConfig {
    const metadata = thinkingMetadataForModel(model.id);
    const cost = MODEL_COSTS[model.id] ?? ZERO_MODEL_COST;

    return {
        id: model.id,
        name: displayName(model),
        api: model.api,
        baseUrl: baseUrlForModel(apiBase, model.api),
        reasoning: model.reasoning,
        ...(metadata === undefined ? {} : { thinkingLevelMap: metadata.thinkingLevelMap }),
        input: [...inputModalitiesForModel(model.id)],
        cost: {
            input: cost.input,
            output: cost.output,
            cacheRead: cost.cacheRead,
            cacheWrite: cost.cacheWrite,
            ...(cost.tiers === undefined
                ? {}
                : {
                      tiers: cost.tiers.map((tier) => ({
                          input: tier.input,
                          output: tier.output,
                          cacheRead: tier.cacheRead,
                          cacheWrite: tier.cacheWrite,
                          inputTokensAbove: tier.inputTokensAbove,
                      })),
                  }),
        },
        contextWindow: model.contextWindow,
        maxTokens: model.maxTokens,
        compat: compatForModel(model),
    };
}

/**
 * Sign in: paste an API key (works from any device), or the provider's browser sign-in, whose callback comes back to
 * this server, so it needs a browser on the machine that runs Pi Pocket.
 */
async function commandCodeLogin(callbacks: OAuthLogin): Promise<OAuthCredentials> {
    const choose = callbacks.onSelect?.bind(callbacks);
    const choice = await choose?.({
        message: "Sign in to Command Code",
        options: [
            { id: "key", label: "Paste an API key (works from any device)" },
            { id: "browser", label: "Sign in with a browser on this server's machine" },
        ],
    });

    if (choice === "browser") {
        return browserLogin(callbacks);
    }

    const key = sanitizeApiKey(
        await callbacks.onPrompt({
            message: "Paste your Command Code API key:",
            placeholder: "user_…",
        }),
    );

    if (key === "") {
        throw new Error("No Command Code API key was entered.");
    }

    await validateApiKey(key);

    return credentialsFromApiKey(key);
}

export default async function createCommandCode(
    host: PocketHost,
    web?: ExtensionWeb,
): Promise<void> {
    // A server whose checkout changed under a running process, or one older than `registerModelProvider`.
    if (web === undefined || typeof host.registerModelProvider !== "function") {
        return;
    }

    const apiBase = process.env.COMMANDCODE_API_BASE ?? DEFAULT_PROVIDER_API_BASE;
    const modelsUrl = process.env.COMMANDCODE_MODELS_URL ?? DEFAULT_MODELS_URL;
    const cachePath =
        process.env.COMMANDCODE_MODELS_CACHE ?? join(host.agentDir, "commandcode-models.json");
    const headers = commandCodeHeaders();
    // The last catalog this provider fetched: until one is there, the provider offers its sign-in and no models, and
    // Menu → Providers → Refresh models fetches the catalog over the network.
    let catalog: readonly CommandCodeModel[] = await loadCachedCommandCodeModels(cachePath);

    const config: ProviderConfig = {
        name: "Command Code",
        baseUrl: apiBase,
        // A stored sign-in wins; this lets an owner keep the key in the server's environment instead.
        apiKey: "$COMMAND_CODE_API_KEY",
        ...(headers === undefined ? {} : { headers }),
        oauth: {
            name: "Command Code",
            login: commandCodeLogin,
            refreshToken: async (credentials) => refreshToken(credentials as OAuthCredentials),
            getApiKey,
        },
        refreshModels: async (context) => {
            if (!context.allowNetwork) {
                return catalog.map((model) => modelConfig(model, apiBase));
            }

            const loaded = await loadCommandCodeModels({
                url: modelsUrl,
                cachePath,
                timeoutMs: getModelsTimeoutMs(),
                signal: context.signal,
            });

            if (loaded.models.length === 0) {
                throw new Error(loaded.warning ?? "Command Code returned no models.");
            }

            catalog = loaded.models;

            return catalog.map((model) => modelConfig(model, apiBase));
        },
        ...(catalog.length === 0
            ? {}
            : { models: catalog.map((model) => modelConfig(model, apiBase)) }),
    };

    web.onDispose(host.registerModelProvider("commandcode", config));

    // The account's endpoints cost four requests: the menu's hint and the sheet share one answer for a moment.
    let asked: { at: number; quota: CommandCodeQuota; view: UsageView } | undefined;

    const readQuota = async (fresh = false): Promise<CommandCodeQuotaResult> => {
        if (!fresh && asked !== undefined && Date.now() - asked.at < QUOTA_FRESH_MS) {
            return { ok: true, quota: asked.quota };
        }

        const apiKey = getConfiguredApiKey({ authPaths: [join(host.agentDir, "auth.json")] });

        if (apiKey === undefined) {
            return {
                ok: false,
                error: {
                    kind: "config",
                    message:
                        "Command Code has no sign-in yet: Menu → Providers → Command Code → API key.",
                },
            };
        }

        const result = await fetchCommandCodeQuota({
            apiKey,
            baseUrl: accountApiBase(apiBase),
            ...(headers === undefined ? {} : { extraHeaders: headers }),
        });

        if (result.ok) {
            const at = Date.now();

            asked = { at, quota: result.quota, view: usageView(result.quota, at) };
        }

        return result;
    };

    const usageView = (quota: CommandCodeQuota, at: number): UsageView => {
        const remaining = quota.credits?.remainingCredits ?? 0;
        const spent = quota.summary?.totalCost ?? 0;
        const pool = remaining + spent;

        return {
            at,
            remaining,
            spent,
            pool,
            percent: pool > 0 ? Math.round((spent / pool) * 100) : 0,
            plan: quota.subscription?.status ?? null,
            periodEnd: quota.subscription?.currentPeriodEnd ?? null,
            windows: (quota.credits?.windowLimits ?? []).map((limit) => ({
                id: limit.window,
                used: limit.used,
                cap: limit.cap,
                percent: limit.cap > 0 ? Math.round((limit.used / limit.cap) * 100) : 0,
                resetAt: limit.resetAt,
            })),
            unavailable: [...(quota.unavailable ?? [])],
        };
    };

    const usageRoute = async (fresh: boolean): Promise<UsageView> => {
        const result = await readQuota(fresh);

        if (!result.ok) {
            throw web.error(
                result.error.kind === "config" ? 400 : 502,
                redactValue(result.error.message),
            );
        }

        // `readQuota` stored the view of the answer it gave, cached or new.
        return asked!.view;
    };

    // The owner's alone: the menu row, its sheet, and this route are not there for anyone else.
    web.route("GET", "usage", () => usageRoute(false), { access: "owner" });
    web.route(
        "POST",
        "usage",
        (request: WebRequest) =>
            usageRoute((request.body as { fresh?: unknown } | undefined)?.fresh === true),
        { access: "owner" },
    );
    web.client("commandcode", { access: "owner" });

    // The owner's alone: the card goes to the session it was typed in, so the account's login (an email) stays out.
    web.command("commandcode-quota", {
        description: "Show Command Code usage, credits, and limits",
        scope: "global",
        handler: async () => {
            const result = await readQuota();

            if (!result.ok) {
                return {
                    type: "toast",
                    level: result.error.kind === "config" ? "warning" : "error",
                    message: redactValue(result.error.message),
                };
            }

            return {
                type: "card",
                output: formatQuota({
                    ...result.quota,
                    account: {
                        ...result.quota.account,
                        login: result.quota.account.keyName ?? "Command Code",
                    },
                }),
            };
        },
    });
}
