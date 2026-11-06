// The Go path of the vendored Command Code provider (`src/server/commandcode/generate/`): the client for
// `/alpha/generate`, which serves an account the Provider API refuses, and the router that falls back to it on
// `403 upgrade_required` and nowhere else.
import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCommandCodeCost } from "../src/server/commandcode/generate/cost.ts";
import { createStreamCommandCode } from "../src/server/commandcode/generate/core.ts";
import { createCommandCodeTransportRouter } from "../src/server/commandcode/generate/router.ts";
import type {
    AssistantMessageEvent,
    AssistantMessageEventStreamLike,
    ContextLike,
    ModelLike,
    StreamOptions,
} from "../src/server/commandcode/generate/types.ts";

/** What the client sees of a model: its id, and the display price it prices a request with. */
const MODEL: ModelLike = {
    id: "deepseek/deepseek-v4.1-flash",
    api: "commandcode",
    provider: "commandcode",
    maxTokens: 64_000,
    cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 0 },
};

const CONTEXT: ContextLike = {
    systemPrompt: "You help.",
    messages: [{ role: "user", content: "hi" }],
    tools: [],
};

type Stream = AssistantMessageEventStreamLike & {
    events: AssistantMessageEvent[];
    ended: boolean;
};

/** A stream of the client's own protocol: producers push into it, and a test reads it in order. */
function newStream(): Stream {
    const events: AssistantMessageEvent[] = [];
    const waiters: (() => void)[] = [];
    const stream: Stream = {
        events,
        ended: false,
        push(event) {
            events.push(event);
            waiters.splice(0).forEach((wake) => wake());
        },
        end() {
            stream.ended = true;
            waiters.splice(0).forEach((wake) => wake());
        },
        async *[Symbol.asyncIterator]() {
            for (let index = 0; ; index++) {
                if (index < events.length) {
                    yield events[index]!;
                } else if (stream.ended) {
                    return;
                } else {
                    await new Promise<void>((resolve) => waiters.push(resolve));
                    index--;
                }
            }
        },
    };

    return stream;
}

/** Server-sent events as Command Code sends them: one `data:` line per event, a blank line between. */
function sse(events: unknown[]): Response {
    const body = events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join("");

    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
}

/** The assistant message a failed request ends with, as Pi's own transports build it. */
function failure(model: ModelLike, message: string): AssistantMessageEvent {
    return {
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
            timestamp: 0,
        },
    };
}

/** The answer Pi's own transport ends with, once the Provider API accepted the request. */
function success(model: ModelLike): AssistantMessageEvent {
    return {
        type: "done",
        reason: "stop",
        message: {
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
            api: model.api,
            provider: model.provider,
            model: model.id,
            usage: {
                input: 1,
                output: 1,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 2,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
            },
            stopReason: "stop",
            timestamp: 0,
        },
    };
}

/**
 * Pi's transport as the router sees it: the request goes out through the fetch the router wrapped, and only then does
 * the stream give the one event it ends with. A refused request never gets past the first step.
 */
function providerTransport(
    event: (model: ModelLike) => AssistantMessageEvent,
): (
    model: ModelLike,
    context: ContextLike,
    options?: StreamOptions,
) => AssistantMessageEventStreamLike {
    return (model, _context, options) => ({
        push() {},
        end() {},
        async *[Symbol.asyncIterator]() {
            await options?.fetch?.("https://api.commandcode.ai/provider/v1/messages");

            yield event(model);
        },
    });
}

/** The events a stream gives, once it ends. */
async function collect(
    stream: AsyncIterable<AssistantMessageEvent>,
): Promise<AssistantMessageEvent[]> {
    const events: AssistantMessageEvent[] = [];

    for await (const event of stream) {
        events.push(event);
    }

    return events;
}

/** A fetch that answers with `status` and `body`, whatever it was asked. */
function answer(status: number, body: unknown): typeof fetch {
    return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

/** The client, with a fetch that answers with the given responses in order, and remembers each request. */
function client(responses: Response[]) {
    const asked: { url: string; init: RequestInit | undefined }[] = [];
    const stream = createStreamCommandCode({
        createStream: newStream,
        calculateCost: calculateCommandCodeCost,
        apiBase: "https://api.commandcode.ai",
        env: { COMMAND_CODE_API_KEY: "user_test" },
        cwd: () => "/work/project",
        fetchImpl: (async (input: string | URL | Request, init?: RequestInit) => {
            asked.push({ url: String(input), init });

            const response = responses.shift();

            if (response === undefined) {
                throw new Error("no response left");
            }

            return response;
        }) as typeof fetch,
    });

    return { stream, asked };
}

/** The text a list of events ends up showing. */
function textOf(events: AssistantMessageEvent[]): string {
    return events
        .filter((event) => event.type === "text_delta")
        .map((event) => (event as { delta: string }).delta)
        .join("");
}

test("the generate client streams text, a tool call, and the usage it priced", async () => {
    const { stream, asked } = client([
        sse([
            { type: "text-delta", text: "Hel" },
            { type: "text-delta", text: "lo" },
            { type: "tool-input-start", id: "call-1", toolName: "read" },
            { type: "tool-input-delta", id: "call-1", delta: '{"path":' },
            { type: "tool-input-delta", id: "call-1", delta: '"a.ts"}' },
            { type: "tool-call", toolCallId: "call-1", toolName: "read", input: { path: "a.ts" } },
            {
                type: "finish",
                finishReason: "tool-calls",
                totalUsage: { inputTokens: 100, outputTokens: 20, inputTokenDetails: {} },
            },
        ]),
    ]);

    const events = await collect(stream(MODEL, CONTEXT));

    assert.equal(asked.length, 1);
    assert.equal(asked[0]!.url, "https://api.commandcode.ai/alpha/generate");
    assert.equal(new Headers(asked[0]!.init?.headers).get("authorization"), "Bearer user_test");

    const body = JSON.parse(String(asked[0]!.init?.body)) as {
        params: { model: string; system: string; stream: boolean };
    };

    assert.equal(body.params.model, MODEL.id);
    assert.equal(body.params.system, "You help.");
    assert.equal(body.params.stream, true);

    assert.equal(textOf(events), "Hello");

    const toolCallEnd = events.find((event) => event.type === "toolcall_end");

    assert.deepEqual(
        (toolCallEnd as { toolCall: { name: string; arguments: unknown } } | undefined)?.toolCall,
        { type: "toolCall", id: "call-1", name: "read", arguments: { path: "a.ts" } },
    );

    const done = events.at(-1) as {
        type: string;
        reason: string;
        message: {
            usage: { input: number; output: number; totalTokens: number; cost: { total: number } };
        };
    };

    assert.equal(done.type, "done");
    assert.equal(done.reason, "toolUse");
    assert.equal(done.message.usage.input, 100);
    assert.equal(done.message.usage.output, 20);
    assert.equal(done.message.usage.totalTokens, 120);
    assert.ok(done.message.usage.cost.total > 0);
});

test("the generate client refuses images for a model the catalog marks text-only", async () => {
    const { stream, asked } = client([sse([{ type: "finish", finishReason: "stop" }])]);
    const textOnly: ModelLike = { ...MODEL, input: ["text"] };
    const withImage: ContextLike = {
        messages: [
            {
                role: "user",
                content: [{ type: "image", data: "AAAA", mimeType: "image/png" }],
            },
        ],
    };

    const events = await collect(stream(textOnly, withImage));

    assert.equal(asked.length, 0);
    assert.equal(events.at(-1)?.type, "error");
    assert.match(
        (events.at(-1) as { error: { errorMessage: string } }).error.errorMessage,
        /does not support image/,
    );
});

test("a 403 upgrade_required serves the request from the generate endpoint, and stays there for the same key", async () => {
    const providerCalls: string[] = [];
    const generate = client([
        sse([
            { type: "text-delta", text: "from generate" },
            { type: "finish", finishReason: "stop" },
        ]),
        sse([
            { type: "text-delta", text: "again" },
            { type: "finish", finishReason: "stop" },
        ]),
    ]);
    const refused = providerTransport((model) =>
        failure(model, "Command Code API error 403: upgrade_required"),
    );
    const router = createCommandCodeTransportRouter<ModelLike, ContextLike>({
        createStream: newStream,
        streamProvider: (model, context, options) => {
            providerCalls.push(model.id);

            return refused(model, context, options);
        },
        streamGenerate: (model, context, options) => generate.stream(model, context, options),
    });
    const options = {
        apiKey: "user_go",
        fetch: answer(403, { error: { code: "upgrade_required" } }),
    } satisfies StreamOptions;

    const first = await collect(router.stream(MODEL, CONTEXT, options));

    assert.equal(router.getTransport(), "generate");
    assert.equal(textOf(first), "from generate");
    assert.ok(!first.some((event) => event.type === "error"));

    // The same key is still on the Go plan: the fallback stays, and the Provider API is not asked again.
    const second = await collect(router.stream(MODEL, CONTEXT, options));

    assert.equal(textOf(second), "again");
    assert.equal(providerCalls.length, 1);
});

test("a 403 that is not upgrade_required does not fall back", async () => {
    let generated = 0;
    const refused = providerTransport((model) =>
        failure(model, "Command Code API error 403: forbidden"),
    );
    const router = createCommandCodeTransportRouter<ModelLike, ContextLike>({
        createStream: newStream,
        streamProvider: refused,
        streamGenerate: (model, context) => {
            generated++;

            return newStream() as AssistantMessageEventStreamLike;
        },
    });

    const events = await collect(
        router.stream(MODEL, CONTEXT, {
            apiKey: "user_x",
            fetch: answer(403, { error: { code: "forbidden" } }),
        }),
    );

    assert.equal(generated, 0);
    assert.equal(router.getTransport(), "provider");
    assert.equal(events.at(-1)?.type, "error");
});

test("a new key probes the Provider API again", async () => {
    const providerCalls: string[] = [];
    const generate = client([
        sse([{ type: "finish", finishReason: "stop" }]),
        sse([{ type: "finish", finishReason: "stop" }]),
    ]);
    const refused = providerTransport((model) =>
        failure(model, "Command Code API error 403: upgrade_required"),
    );
    const router = createCommandCodeTransportRouter<ModelLike, ContextLike>({
        createStream: newStream,
        streamProvider: (model, context, options) => {
            providerCalls.push("provider");

            return options?.apiKey === "max"
                ? providerTransport(() => success(model))(model, context, options)
                : refused(model, context, options);
        },
        streamGenerate: (model, context, options) => generate.stream(model, context, options),
    });
    const options = {
        apiKey: "go",
        fetch: answer(403, { error: { code: "upgrade_required" } }),
    } satisfies StreamOptions;

    await collect(router.stream(MODEL, CONTEXT, options));
    assert.equal(router.getTransport(), "generate");

    // Another key is another account: it is probed, and this one has Provider API access, so no fallback is needed.
    const events = await collect(
        router.stream(MODEL, CONTEXT, { ...options, apiKey: "max", fetch: answer(200, {}) }),
    );

    assert.deepEqual(providerCalls, ["provider", "provider"]);
    assert.equal(router.getTransport(), "provider");
    assert.equal(events.at(-1)?.type, "done");
});
