/**
 * Command Code: its Provider API as a model provider, with a browser or API-key sign-in and the live model catalog.
 *
 * Vendored from `patlux/pi-commandcode-provider` (`src/server/commandcode/`): the catalog, its cache, and the
 * sign-in. Streaming goes through Pi's own OpenAI Chat Completions, OpenAI Responses, and Anthropic Messages
 * transports, which the catalog chooses for each model.
 */
import type { ProviderConfig } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
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
import type { ExtensionWeb, PocketHost } from "../host.ts";

/** A chat model's config: the union `models` takes narrows to this one by its required `reasoning`. */
type ChatModelConfig = Extract<
    NonNullable<ProviderConfig["models"]>[number],
    { reasoning: boolean }
>;
type OAuthLogin = Parameters<NonNullable<ProviderConfig["oauth"]>["login"]>[0];

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

/** One model as Pi's runtime takes it: its wire, limits, image input, thinking levels, and display price. */
function modelConfig(model: CommandCodeModel, apiBase: string): ChatModelConfig {
    const metadata = thinkingMetadataForModel(model.id);
    const cost = MODEL_COSTS[model.id] ?? ZERO_MODEL_COST;

    return {
        id: model.id,
        // The catalog adds "(CC)" to its names: the provider id already says Command Code.
        name: model.name.replace(/ \(CC\)$/, ""),
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
}
