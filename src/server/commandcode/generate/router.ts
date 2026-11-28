import type { AssistantMessageEventStreamLike, ModelLike, StreamOptions } from "./types.ts";

export type CommandCodeTransport = "unknown" | "provider" | "generate";

interface TransportDependencies<TModel extends ModelLike, TContext> {
    createStream: () => AssistantMessageEventStreamLike;
    /** Pi's own transport for the model's wire. */
    streamProvider: (
        model: TModel,
        context: TContext,
        options?: StreamOptions,
    ) => AssistantMessageEventStreamLike;
    /** Command Code's generate endpoint, for an account the Provider API refuses. */
    streamGenerate: (
        model: TModel,
        context: TContext,
        options?: StreamOptions,
    ) => AssistantMessageEventStreamLike;
}

const MODEL_NOT_IN_PLAN =
    "Command Code refused this model for the current plan (403 MODEL_NOT_IN_PLAN). " +
    "Select a model included in your plan or check your model access in Command Code. " +
    "This is a model-specific refusal, not a sign-in failure.";

/** Why the Provider API refused a request: the plan, or one model the plan leaves out. */
type ProviderDenial = "upgrade_required" | "model_not_in_plan";

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function providerDenial(response: Response): Promise<ProviderDenial | undefined> {
    if (response.status !== 403) {
        return undefined;
    }

    try {
        const body: unknown = await response.clone().json();

        if (!isRecord(body)) {
            return undefined;
        }

        const error = isRecord(body.error) ? body.error : body;

        if (error.code === "upgrade_required") {
            return "upgrade_required";
        }

        if (
            error.code === "FORBIDDEN" &&
            error.type === "permission_error" &&
            typeof error.message === "string" &&
            error.message.startsWith("MODEL_NOT_IN_PLAN:")
        ) {
            return "model_not_in_plan";
        }
    } catch {
        // A body that cannot be read stays on the host's own error path.
    }

    return undefined;
}

export function createCommandCodeTransportRouter<TModel extends ModelLike, TContext>(
    deps: TransportDependencies<TModel, TContext>,
) {
    let transport: CommandCodeTransport = "unknown";
    let generation = 0;
    let apiKey: string | undefined;

    function pipe(
        source: AssistantMessageEventStreamLike,
        target: AssistantMessageEventStreamLike,
    ): Promise<void> {
        return (async () => {
            for await (const event of source) {
                target.push(event);
            }
        })();
    }

    return {
        getTransport(): CommandCodeTransport {
            return transport;
        },

        reset(): void {
            generation += 1;
            transport = "unknown";
            apiKey = undefined;
        },

        stream(
            model: TModel,
            context: TContext,
            options?: StreamOptions,
        ): AssistantMessageEventStreamLike {
            if (options?.apiKey !== apiKey) {
                generation += 1;
                apiKey = options?.apiKey;
                transport = "unknown";
            }

            const requestGeneration = generation;

            if (transport === "generate") {
                return deps.streamGenerate(model, context, options);
            }

            const output = deps.createStream();
            let denial: ProviderDenial | undefined;
            const fetchImpl = options?.fetch ?? fetch;
            const providerOptions: StreamOptions = {
                ...options,
                fetch: async (input, init) => {
                    const response = await fetchImpl(input, init);

                    denial ??= await providerDenial(response);

                    return response;
                },
                onResponse: async (response, responseModel) => {
                    if (denial === "upgrade_required") {
                        return;
                    }

                    await options?.onResponse?.(response, responseModel);
                },
            };

            const run = async () => {
                const providerStream = deps.streamProvider(model, context, providerOptions);

                try {
                    for await (const event of providerStream) {
                        if (denial) {
                            continue;
                        }

                        if (generation === requestGeneration) {
                            transport = "provider";
                        }

                        output.push(event);
                    }
                } catch (error) {
                    // Defense in depth for adapters whose iterators reject after HTTP errors;
                    // current Pi/OMP adapters emit error events instead. Only an inspected 403
                    // permits generate fallback or a denial's own explanation.
                    if (!denial) {
                        throw error;
                    }
                }

                if (denial === "upgrade_required") {
                    if (generation === requestGeneration) {
                        transport = "generate";
                    }

                    await pipe(deps.streamGenerate(model, context, options), output);
                } else if (denial === "model_not_in_plan") {
                    if (generation === requestGeneration) {
                        transport = "provider";
                    }

                    throw new Error(MODEL_NOT_IN_PLAN);
                }

                output.end();
            };

            run().catch((error: unknown) => {
                const message = error instanceof Error ? error.message : String(error);

                output.push({
                    type: "error",
                    reason: "error",
                    error: {
                        role: "assistant",
                        content: [],
                        api: model.api,
                        provider: model.provider,
                        model: model.id,
                        usage: {
                            input: 0,
                            output: 0,
                            cacheRead: 0,
                            cacheWrite: 0,
                            totalTokens: 0,
                            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
                        },
                        stopReason: "error",
                        errorMessage: message,
                        timestamp: Date.now(),
                    },
                });
                output.end();
            });

            return output;
        },
    };
}
