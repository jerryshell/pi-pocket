// Prompt-cache misses (`src/server/cache-misses.ts`): what a request paid again, counted from Pi Durable's answers.
import assert from "node:assert/strict";
import { test } from "node:test";
import type { EntryRecord } from "@earendil-works/pi-durable";
import { scanCacheMisses } from "../src/server/cache-misses.ts";

type Answer = {
    id: number;
    input?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: { input?: number; cacheRead?: number; cacheWrite?: number };
    provider?: string;
    model?: string;
    at?: number;
};

/** An assistant entry as Pi Durable stores one: the message, with its usage and cost. */
const entry = (answer: Answer, kind = "pi.assistant"): EntryRecord =>
    ({
        id: answer.id,
        conversationId: 1,
        kind,
        model: [
            {
                role: "assistant",
                provider: answer.provider ?? "anthropic",
                model: answer.model ?? "claude-sonnet-5",
                timestamp: answer.at ?? 1_000_000,
                usage: {
                    input: answer.input ?? 0,
                    output: 10,
                    cacheRead: answer.cacheRead ?? 0,
                    cacheWrite: answer.cacheWrite ?? 0,
                    totalTokens: 10,
                    cost: {
                        input: answer.cost?.input ?? 0,
                        output: 0,
                        cacheRead: answer.cost?.cacheRead ?? 0,
                        cacheWrite: answer.cost?.cacheWrite ?? 0,
                        total: 0,
                    },
                },
            },
        ],
    }) as unknown as EntryRecord;

const cacheReadPrice = () => 2;

test("the first request, and a provider that never reports cache use, count nothing", () => {
    const first = scanCacheMisses([entry({ id: 1, input: 100_000 })]);

    assert.equal(first.waste.missCount, 0);

    // Two requests, neither with a cache read or write: the provider says nothing about caching.
    const quiet = scanCacheMisses([
        entry({ id: 1, input: 100_000, at: 1_000_000 }),
        entry({ id: 2, input: 120_000, at: 1_300_000 }),
    ]);

    assert.equal(quiet.waste.missCount, 0);
});

test("a prompt the provider no longer held is counted, with what it cost beyond a cache read", () => {
    const scan = scanCacheMisses(
        [
            // A cache write of 200k costs $5.00, so the provider reported cache activity.
            entry({ id: 1, cacheWrite: 200_000, cost: { cacheWrite: 5 }, at: 1_000_000 }),
            // The next prompt of 200k was all input, at $6.00; a cache read would have been $2/M.
            entry({ id: 2, input: 200_000, cost: { input: 6 }, at: 1_420_000 }),
        ],
        cacheReadPrice,
    );

    const miss = scan.misses.get(2);

    assert.deepEqual(miss, {
        missedTokens: 200_000,
        missedCost: 5.6,
        idleMs: 420_000,
        modelChanged: false,
    });
    assert.deepEqual(scan.waste, { missedTokens: 200_000, missedCost: 5.6, missCount: 1 });
});

test("the cache-read rate comes from the message when it read any, and from the model otherwise", () => {
    const withRead = scanCacheMisses(
        [
            entry({ id: 1, cacheRead: 100_000, cost: { cacheRead: 0.5 }, at: 1_000_000 }),
            entry({
                id: 2,
                input: 50_000,
                cacheRead: 50_000,
                cost: { input: 1.5, cacheRead: 0.25 },
                at: 1_100_000,
            }),
        ],
        () => 0,
    );

    // The half that was not read costs $1.50 / 50k, less the $0.25 / 50k it would have cost as a read.
    assert.equal(withRead.misses.get(2)?.missedTokens, 50_000);
    assert.equal(withRead.misses.get(2)?.missedCost, 1.25);
});

test("a miss at the noise floor, a prompt that only grows, and a full cache read count nothing", () => {
    const cached = entry({ id: 1, cacheRead: 100_000, at: 1_000_000 });
    const quiet = scanCacheMisses(
        [
            cached,
            // 500 tokens were not read: breakpoint granularity.
            entry({ id: 2, cacheRead: 99_500, at: 1_100_000 }),
            // The prompt grew by 20k, and all of it was new content, not a rebill.
            entry({ id: 3, cacheRead: 100_000, input: 20_000, at: 1_200_000 }),
            // Everything the last request had was read from the cache.
            entry({ id: 4, cacheRead: 120_000, at: 1_300_000 }),
        ],
        cacheReadPrice,
    );

    assert.equal(quiet.waste.missCount, 0);
});

test("a compaction or a fresh start resets the comparison", () => {
    const rows = [
        entry({ id: 1, cacheRead: 100_000, at: 1_000_000 }),
        entry({ id: 2 }, "pi.compaction"),
        entry({ id: 3, cacheWrite: 120_000, at: 1_100_000 }),
        entry({ id: 4 }, "pi.reset"),
        entry({ id: 5, cacheWrite: 140_000, at: 1_200_000 }),
    ];

    assert.equal(scanCacheMisses(rows, cacheReadPrice).waste.missCount, 0);
});

test("a model switch is named, and a missing timestamp leaves the idle time unknown", () => {
    const scan = scanCacheMisses(
        [
            entry({ id: 1, cacheRead: 100_000, at: undefined }),
            entry({ id: 2, input: 100_000, model: "claude-opus-5", at: undefined }),
        ],
        cacheReadPrice,
    );

    assert.equal(scan.misses.get(2)?.modelChanged, true);
    assert.equal(scan.misses.get(2)?.idleMs, 0);
});

test("an answer without usage is skipped, and the request before it still counts", () => {
    const scan = scanCacheMisses(
        [
            entry({ id: 1, cacheRead: 100_000, at: 1_000_000 }),
            {
                id: 2,
                conversationId: 1,
                kind: "pi.assistant",
                model: [{ role: "assistant", timestamp: 1_100_000 }],
            } as unknown as EntryRecord,
            entry({ id: 3, input: 100_000, at: 1_200_000 }),
        ],
        cacheReadPrice,
    );

    assert.equal(scan.misses.get(3)?.missedTokens, 100_000);
});
