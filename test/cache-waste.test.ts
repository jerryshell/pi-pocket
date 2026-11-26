// A conversation's prompt-cache misses reach the room's view: the miss rides on the answer that paid it, and the stats
// count the session's total (`src/server/cache-misses.ts`, `room.ts`, and the projection's `cacheMiss`).
import {
    type App,
    cleanUp,
    context,
    fakeTab,
    newSession,
    openApp,
    owner,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationId } from "@earendil-works/pi-durable";

let app: App;

before(async () => {
    app = await openApp(scriptedModel());
});

after(async () => {
    await app?.close();
    cleanUp();
});

const at = (seconds: number) => 1_000_000 + seconds * 1_000;

/** An answer as Pi Durable keeps it, with the usage its request billed. */
async function answer(id: ConversationId, usage: Usage, timestamp: number): Promise<void> {
    const message = { ...fauxAssistantMessage("done"), timestamp, usage };

    await app.harness.commit(async (tx) => {
        await tx.appendEntry(id, { kind: "pi.assistant", model: [message] });
    }, context);
}

test("the answer that paid a cache miss carries it, and the stats count it", async () => {
    const id = await newSession(app);
    const tab = fakeTab(id, owner(app));

    await app.attach(tab.client);

    try {
        // A cache write of 100k at $37.50/M, then 7 minutes later the same prompt as input at $30/M.
        await answer(
            id,
            {
                input: 0,
                output: 10,
                cacheRead: 0,
                cacheWrite: 100_000,
                totalTokens: 100_010,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 3.75, total: 3.75 },
            },
            at(0),
        );
        await answer(
            id,
            {
                input: 100_000,
                output: 10,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 100_010,
                cost: { input: 3, output: 0, cacheRead: 0, cacheWrite: 0, total: 3 },
            },
            at(420),
        );

        const views = () =>
            tab.events.filter((each) => each.event === "view").map((each) => each.data);
        const miss = () =>
            views()
                .flatMap(
                    (data) =>
                        (data.entries ?? []) as {
                            kind: string;
                            cacheMiss?: Record<string, number | boolean>;
                        }[],
                )
                .findLast((entry) => entry.kind === "assistant" && entry.cacheMiss !== undefined)
                ?.cacheMiss;
        const waste = () =>
            views()
                .map((data) => data.stats as { cacheWaste?: Record<string, number> } | undefined)
                .findLast((stats) => stats?.cacheWaste !== undefined)?.cacheWaste;

        await until(() => miss() !== undefined && waste() !== undefined, "the cache miss's view");

        assert.deepEqual(miss(), {
            missedTokens: 100_000,
            missedCost: 3,
            idleMs: 420_000,
            modelChanged: false,
        });
        assert.deepEqual(waste(), { missedTokens: 100_000, missedCost: 3, missCount: 1 });
    } finally {
        app.detach(tab.client);
    }
});
