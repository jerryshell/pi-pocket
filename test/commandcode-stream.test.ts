// The Responses stream adapter (`commandcode/responses-stream.ts`): Command Code's non-standard reasoning frames, and
// the plaintext `encrypted_content` that GLM-5.3 sends instead of a reasoning delta.
import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCommandCodeResponsesResponse } from "../src/server/commandcode/responses-stream.ts";

const GLM_TEXT = "Count the r's: s-t-r-a-w-b-e-r-r-y. Three r's.";
const PLAINTEXT = { plaintextReasoningContent: true };

function sseHeaders(): Record<string, string> {
    return { "content-type": "text/event-stream; charset=utf-8" };
}

async function readAll(response: Response): Promise<string> {
    const reader = response.body!.getReader();
    const decoder = new TextDecoder("utf-8", { ignoreBOM: true });
    let output = "";

    for (;;) {
        const { done, value } = await reader.read();

        if (done) {
            break;
        }

        output += decoder.decode(value, { stream: true });
    }

    output += decoder.decode();

    return output;
}

async function normalize(
    input: string,
    options?: { plaintextReasoningContent?: boolean },
): Promise<string> {
    return readAll(
        normalizeCommandCodeResponsesResponse(
            new Response(input, { headers: sseHeaders() }),
            undefined,
            options,
        ),
    );
}

function reasoningItem(extra: Record<string, unknown> = {}) {
    return { id: "rs_glm", type: "reasoning", summary: [], ...extra };
}

function frames(ending = "\n") {
    const added = {
        type: "response.output_item.added",
        output_index: 0,
        item: reasoningItem(),
    };
    const done = {
        type: "response.output_item.done",
        output_index: 0,
        item: reasoningItem({ encrypted_content: GLM_TEXT }),
    };

    return {
        added: `event: response.output_item.added${ending}data: ${JSON.stringify(added)}${ending}${ending}`,
        done: `event: response.output_item.done${ending}data: ${JSON.stringify(done)}${ending}${ending}`,
        delta:
            `event: response.reasoning_text.delta${ending}` +
            `data: ${JSON.stringify({
                type: "response.reasoning_text.delta",
                output_index: 0,
                content_index: 0,
                delta: GLM_TEXT,
                item_id: "rs_glm",
            })}${ending}${ending}`,
    };
}

test("a non-standard reasoning delta becomes the canonical one, across split chunks", async () => {
    const event = { type: "response.reasoning.delta", output_index: 0, delta: "наб" };
    const frame = `event: response.reasoning.delta\ndata: ${JSON.stringify(event)}\n\n`;
    const bytes = new TextEncoder().encode(frame);
    const cut = bytes.length - 3;
    const source = new ReadableStream<Uint8Array>({
        start(controller) {
            controller.enqueue(bytes.slice(0, cut));
            controller.enqueue(bytes.slice(cut));
            controller.close();
        },
    });
    const output = await readAll(
        normalizeCommandCodeResponsesResponse(
            new Response(source, { status: 200, headers: sseHeaders() }),
        ),
    );

    assert.match(output, /^event: response\.reasoning_text\.delta\n/);

    const dataLine = output.split("\n").find((line) => line.startsWith("data: "));
    const payload = JSON.parse((dataLine ?? "").slice("data: ".length)) as Record<string, unknown>;

    assert.equal(payload.type, "response.reasoning_text.delta");
    assert.equal(payload.delta, "наб");
});

test("a plaintext reasoning item is emitted as a delta just before it completes", async () => {
    const stream = frames();

    assert.equal(
        await normalize(stream.added + stream.done, PLAINTEXT),
        stream.added + stream.delta + stream.done,
    );
});

test("the same stream stays byte-identical without the model trait", async () => {
    const stream = frames();

    assert.equal(await normalize(stream.added + stream.done), stream.added + stream.done);
    assert.equal(
        await normalize(stream.added + stream.done, { plaintextReasoningContent: false }),
        stream.added + stream.done,
    );
});

test("text that already arrived as a reasoning delta is not repeated", async () => {
    const stream = frames();
    const earlier =
        'event: response.reasoning_text.delta\ndata: {"type":"response.reasoning_text.delta","output_index":0,"delta":"already"}\n\n';
    const output = await normalize(earlier + stream.added + stream.done, PLAINTEXT);

    assert.equal(output, earlier + stream.added + stream.done);
    assert.equal(output.split("event: response.reasoning_text.delta").length - 1, 1);
});

test("an item that carries a canonical summary stays untouched", async () => {
    const done = {
        type: "response.output_item.done",
        output_index: 0,
        item: reasoningItem({
            encrypted_content: GLM_TEXT,
            summary: [{ type: "summary_text", text: "host renders this" }],
        }),
    };
    const input =
        'event: response.output_item.added\ndata: {"type":"response.output_item.added","output_index":0,"item":{"id":"rs_glm","type":"reasoning","summary":[]}}\n\n' +
        `event: response.output_item.done\ndata: ${JSON.stringify(done)}\n\n`;

    assert.equal(await normalize(input, PLAINTEXT), input);
});

test("an injected frame matches the stream's CRLF line endings", async () => {
    const stream = frames("\r\n");

    assert.equal(
        await normalize(stream.added + stream.done, PLAINTEXT),
        stream.added + stream.delta + stream.done,
    );
});

test("only an okay SSE response is wrapped", async () => {
    const json = new Response("{}", { headers: { "content-type": "application/json" } });
    const refused = new Response("nope", {
        status: 400,
        headers: { "content-type": "text/event-stream" },
    });

    assert.equal(normalizeCommandCodeResponsesResponse(json), json);
    assert.equal(normalizeCommandCodeResponsesResponse(refused), refused);
});
