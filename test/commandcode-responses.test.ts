// The Responses wire repairs (`commandcode/responses-compat.ts`): the two Provider API quirks that Pi's own encoder
// cannot express, for the two models proven to refuse them.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
    modelWireTraits,
    repairResponsesPayload,
    RESPONSES_WIRE_REPAIRS,
} from "../src/server/commandcode/responses-compat.ts";

/** A payload shaped like the one Pi sends: a leading system item, then a user turn. */
function payload(model = "zai-org/GLM-5.3", extra: Record<string, unknown> = {}) {
    return {
        model,
        input: [
            { role: "system", content: "You are a coding agent." },
            { role: "user", content: [{ type: "input_text", text: "hey" }] },
        ],
        stream: true,
        store: false,
        ...extra,
    };
}

test("the stream trait is on only for the model whose reasoning item was measured", () => {
    assert.deepEqual(modelWireTraits("zai-org/GLM-5.3"), { plaintextReasoningContent: true });

    for (const modelId of [
        "mistral/mistral-large-4",
        "z-ai/glm-5.3-flash",
        "z-ai/glm-5.3-flashx",
        "gpt-6-sol",
        "",
    ]) {
        assert.deepEqual(
            modelWireTraits(modelId),
            { plaintextReasoningContent: false },
            `${modelId || "<empty>"} stays opt-out until a capture shows the shape`,
        );
    }
});

test("the repair list holds exactly the models proven to need one", () => {
    assert.deepEqual(Object.keys(RESPONSES_WIRE_REPAIRS).sort(), [
        "mistral/mistral-large-4",
        "zai-org/GLM-5.3",
    ]);
    assert.deepEqual(RESPONSES_WIRE_REPAIRS["zai-org/GLM-5.3"], {
        messageItemType: true,
        dropNoneEffort: true,
    });
    assert.deepEqual(
        RESPONSES_WIRE_REPAIRS["mistral/mistral-large-4"],
        { dropNoneEffort: true },
        "Mistral takes the shorthand; only its effort value is refused",
    );
});

test("the system and user items get their message type, and typed items stay as they are", () => {
    const body = payload();
    const typed = [
        { type: "message", role: "assistant", content: [{ type: "output_text", text: "ok" }] },
        { type: "function_call", call_id: "c1", name: "bash", arguments: "{}" },
    ];

    body.input.push(...(typed as never[]));

    const repaired = repairResponsesPayload(body, "zai-org/GLM-5.3") as {
        input: Record<string, unknown>[];
    };

    assert.deepEqual(repaired.input[0], {
        type: "message",
        role: "system",
        content: "You are a coding agent.",
    });
    assert.deepEqual(repaired.input[1], {
        type: "message",
        role: "user",
        content: [{ type: "input_text", text: "hey" }],
    });
    assert.deepEqual(repaired.input.slice(2), typed, "an item that has a type is left alone");
    assert.deepEqual(
        repairResponsesPayload(repaired, "zai-org/GLM-5.3"),
        repaired,
        "a second pass changes nothing",
    );
});

test("an item without content, or with a role of its own, keeps no message type", () => {
    const body = { model: "zai-org/GLM-5.3", input: [{ role: "user" }, { role: "tool" }] };

    assert.equal(repairResponsesPayload(body, "zai-org/GLM-5.3"), body, "nothing changed");
});

test("reasoning that only says effort none is dropped, for either model", () => {
    for (const model of ["zai-org/GLM-5.3", "mistral/mistral-large-4"]) {
        const repaired = repairResponsesPayload(
            payload(model, { reasoning: { effort: "none" } }),
            model,
        ) as Record<string, unknown>;

        assert.equal("reasoning" in repaired, false, `${model} gets no empty reasoning`);
        assert.equal(repaired.model, model);
    }
});

test("reasoning that carries a real effort or another field stays", () => {
    for (const reasoning of [{ effort: "low" }, { effort: "none", summary: "auto" }, {}]) {
        const body = payload("mistral/mistral-large-4", { reasoning });

        assert.equal(repairResponsesPayload(body, "mistral/mistral-large-4"), body);
    }
});

test("another model, a payload that is not an object, and a prototype key pass through untouched", () => {
    const other = payload("gpt-5.6-sol", { reasoning: { effort: "none" } });

    assert.equal(repairResponsesPayload(other, "gpt-5.6-sol"), other);
    assert.equal(repairResponsesPayload("not a payload", "zai-org/GLM-5.3"), "not a payload");
    assert.equal(repairResponsesPayload(null, "zai-org/GLM-5.3"), null);

    const named = payload();

    assert.equal(repairResponsesPayload(named, "toString"), named, "a name no model has");
});

test("the payload it was given keeps its shape", () => {
    const body = payload("zai-org/GLM-5.3", { reasoning: { effort: "none" } });
    const before = structuredClone(body);

    repairResponsesPayload(body, "zai-org/GLM-5.3");
    assert.deepEqual(body, before, "the caller's own payload is not rewritten under it");
});
