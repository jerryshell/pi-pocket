/**
 * Repairs two Provider API wire quirks that Pi's own encoder cannot express (upstream 0.8.3, issues #214 and the
 * Mistral case).
 *
 * ## 1. Untagged message items
 *
 * Pi tags only non-message items (`type: "message"` for assistant text, `function_call`, `function_call_output`,
 * `reasoning`, ...). The leading `system`/`developer` item and every `user` item go out as a bare `{ role, content }`
 * pair. OpenAI accepts that shorthand, but the adapter in front of some models rejects the whole request with
 * `400 invalid_request: input item is missing type` (issue #214, `zai-org/GLM-5.3`). A sweep of all 74 `/responses`
 * models with a minimal text request showed GLM-5.3 is the only one refusing the shorthand, so the rewrite is
 * allowlisted rather than applied to every backend.
 *
 * ## 2. `reasoning.effort: "none"`
 *
 * When thinking is off, Pi emits `reasoning: { effort: "none" }` (it reads the level from `thinkingLevelMap`, which
 * has no `off` entry). Some models reject that value — `zai-org/GLM-5.3` with
 * `unsupported output_config.effort: none`, `mistral/mistral-large-4` with
 * `reasoning_effort none is not supported for this model` — while omitting the `reasoning` field entirely succeeds.
 * Declaring `off: null` in `thinkingLevelMap` is not a fix: Pi then clamps to the lowest allowed level and sends
 * `effort: "low"`, silently forcing reasoning on. So the field is dropped here instead.
 *
 * Both transforms are no-ops for every other model, and for a payload whose shape is not the expected object, because
 * a malformed rewrite would turn a model-specific 400 into a failure for every backend.
 */

/** Model ID -> repairs to apply. Keep it evidence-driven and short. */
export interface ResponsesWireRepair {
    /** Needs an explicit `type: "message"` on role-carrying input items. */
    messageItemType?: boolean;
    /** Rejects `reasoning.effort: "none"`; the field is dropped in that case. */
    dropNoneEffort?: boolean;
}

/**
 * Per-model repairs. An entry is only added once a live request shows the failure, because none of this is verifiable
 * from the test suite alone.
 */
export const RESPONSES_WIRE_REPAIRS: Readonly<Record<string, ResponsesWireRepair>> = {
    "zai-org/GLM-5.3": { messageItemType: true, dropNoneEffort: true },
    "mistral/mistral-large-4": { dropNoneEffort: true },
};

/** Roles that carry an item-level `message` type in the Responses schema. */
const MESSAGE_ROLES: ReadonlySet<string> = new Set(["system", "developer", "user", "assistant"]);

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The input items with `type: "message"` on each role-carrying item that has none, or undefined when none changed. */
function tagMessageItems(input: readonly unknown[]): unknown[] | undefined {
    let changed = false;
    const items = input.map((item) => {
        if (!isRecord(item) || "type" in item) {
            return item;
        }

        if (typeof item.role !== "string" || !MESSAGE_ROLES.has(item.role)) {
            return item;
        }

        if (item.content === undefined) {
            return item;
        }

        changed = true;

        return { type: "message", ...item };
    });

    return changed ? items : undefined;
}

/** The payload without `reasoning`, when that block only says `effort: "none"`; undefined when the block stays. */
function withoutInertReasoning(
    payload: Record<string, unknown>,
): Record<string, unknown> | undefined {
    const reasoning = payload.reasoning;

    if (!isRecord(reasoning)) {
        return undefined;
    }

    if (Object.keys(reasoning).length !== 1 || reasoning.effort !== "none") {
        return undefined;
    }

    const { reasoning: _dropped, ...rest } = payload;

    return rest;
}

/**
 * Applies the repairs for `modelId` to a Responses request payload.
 *
 * Returns the payload itself when nothing changed, so a caller can hand the same object through instead of a copy.
 */
export function repairResponsesPayload(
    payload: unknown,
    modelId: string,
    repairs: Readonly<Record<string, ResponsesWireRepair>> = RESPONSES_WIRE_REPAIRS,
): unknown {
    if (!isRecord(payload) || !Object.hasOwn(repairs, modelId)) {
        return payload;
    }

    const repair = repairs[modelId];

    if (
        repair === undefined ||
        (repair.messageItemType !== true && repair.dropNoneEffort !== true)
    ) {
        return payload;
    }

    // Each step works on a copy, so a no-op repair never mutates the payload the caller still holds.
    let next = payload;
    let changed = false;

    if (repair.messageItemType === true && Array.isArray(next.input)) {
        const items = tagMessageItems(next.input);

        if (items !== undefined) {
            next = { ...next, input: items };
            changed = true;
        }
    }

    if (repair.dropNoneEffort === true) {
        const pruned = withoutInertReasoning(next);

        if (pruned !== undefined) {
            next = pruned;
            changed = true;
        }
    }

    return changed ? next : payload;
}
