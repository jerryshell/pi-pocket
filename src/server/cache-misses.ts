/**
 * Prompt-cache misses: prompt tokens a request had to pay for again because the provider no longer held them cached.
 * Ported from Pi's `core/cache-stats.ts`, which its package does not export, and which reads Pi's own session entries;
 * Pi Pocket's entries are Pi Durable's, so the scan reads `pi.assistant` and starts over at each head marker. Pure
 * functions, with no I/O: a room scans its view's entries and attaches each miss to the answer that paid it.
 */
import type { EntryRecord } from "@earendil-works/pi-durable";

/** The cache lifetime of the providers Pi Pocket runs: a gap this long is the likely cause of a miss. */
export const CACHE_TTL_MS = 5 * 60_000;

/** Misses at or below this are cache breakpoint granularity, not a rebill worth a word. */
const NOISE_FLOOR_TOKENS = 1024;

/** A miss an answer's line shows: this many tokens, or this much money. */
export const CACHE_NOTICE_TOKENS = 20_000;
export const CACHE_NOTICE_COST = 0.1;

/** One answer's rebill: prompt tokens the request before it had, and this one did not read from the cache. */
export interface CacheMiss {
    missedTokens: number;
    /** What those tokens cost beyond the cache-read price, in dollars; 0 when no price is known. */
    missedCost: number;
    /** Time since the request before it, in milliseconds; 0 when a timestamp is missing. */
    idleMs: number;
    modelChanged: boolean;
}

/** A conversation's counted misses, for its status line and its spend. */
export interface CacheWaste {
    missedTokens: number;
    missedCost: number;
    missCount: number;
}

export interface CacheScan {
    /** Each counted miss, by the id of the answer that paid it. */
    misses: Map<number, CacheMiss>;
    waste: CacheWaste;
}

type MessageCost = {
    input?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
};

type MessageUsage = {
    input?: number;
    cacheRead?: number;
    cacheWrite?: number;
    cost?: MessageCost;
};

type MessageLike = {
    usage?: MessageUsage;
    provider?: string;
    model?: string;
    timestamp?: number;
};

/** What the request before this one takes to compare against: its prompt, model, time, and whether it reported cache. */
interface PreviousRequest {
    promptTokens: number;
    modelKey: string;
    timestamp: number | undefined;
    /** A provider that never reports cache activity says nothing about a zero-cache turn. */
    reportedCache: boolean;
}

/** A count of tokens or dollars, with anything that is not a positive finite number read as zero. */
function value(amount: unknown): number {
    return typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function promptTokens(usage: MessageUsage): number {
    return value(usage.input) + value(usage.cacheRead) + value(usage.cacheWrite);
}

function modelKey(message: MessageLike | undefined): string {
    const provider = typeof message?.provider === "string" ? message.provider : "";
    const model = typeof message?.model === "string" ? message.model : "";

    return `${provider}/${model}`;
}

function timestampOf(message: MessageLike | undefined): number | undefined {
    const at = message?.timestamp;

    return typeof at === "number" && Number.isFinite(at) && at > 0 ? at : undefined;
}

/**
 * What this request paid again: the prompt tokens the request before it had that this one did not read from the cache.
 * The first request, a provider that never reports cache use, and a miss of noise-floor size count nothing.
 */
function detectMiss(
    previous: PreviousRequest | undefined,
    usage: MessageUsage,
    message: MessageLike | undefined,
    cacheReadPrice: (provider: string, model: string) => number | undefined,
): CacheMiss | undefined {
    const prompt = promptTokens(usage);

    if (previous === undefined || prompt <= 0) {
        return undefined;
    }

    const cacheRead = value(usage.cacheRead);

    if (cacheRead + value(usage.cacheWrite) === 0 && !previous.reportedCache) {
        return undefined;
    }

    const missedTokens = Math.min(previous.promptTokens, prompt) - cacheRead;

    if (missedTokens <= NOISE_FLOOR_TOKENS) {
        return undefined;
    }

    // Missed tokens land in the input or cache-write buckets, so the paid rate comes from this message's own cost, which
    // has the provider's real prices and tiers. When no cache read was billed, ask the model's price.
    const cost = usage.cost;
    const paidTokens = value(usage.input) + value(usage.cacheWrite);
    const paidPerToken =
        cost === undefined || paidTokens === 0
            ? 0
            : (value(cost.input) + value(cost.cacheWrite)) / paidTokens;
    const readPerToken =
        cost !== undefined && cacheRead > 0
            ? value(cost.cacheRead) / cacheRead
            : (cacheReadPrice(
                  typeof message?.provider === "string" ? message.provider : "",
                  typeof message?.model === "string" ? message.model : "",
              ) ?? 0) / 1_000_000;
    const at = timestampOf(message);
    const idleMs =
        at === undefined || previous.timestamp === undefined
            ? 0
            : Math.max(0, at - previous.timestamp);

    return {
        missedTokens,
        missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
        idleMs,
        modelChanged: modelKey(message) !== previous.modelKey,
    };
}

function previousOf(
    usage: MessageUsage,
    message: MessageLike | undefined,
    reportedCache: boolean,
): PreviousRequest | undefined {
    const prompt = promptTokens(usage);

    if (prompt <= 0) {
        return undefined;
    }

    return {
        promptTokens: prompt,
        modelKey: modelKey(message),
        timestamp: timestampOf(message),
        reportedCache: reportedCache || value(usage.cacheRead) + value(usage.cacheWrite) > 0,
    };
}

/**
 * Count the misses across a conversation's entries. A compaction or a fresh start resets the comparison: the content
 * after it is new to the provider, not a rebill. `cacheReadPrice` is the model's cache-read price, in dollars for a
 * million tokens, for a request whose cost has no cache read to divide.
 */
export function scanCacheMisses(
    entries: readonly EntryRecord[],
    cacheReadPrice: (provider: string, model: string) => number | undefined = () => undefined,
): CacheScan {
    let previous: PreviousRequest | undefined;
    const misses = new Map<number, CacheMiss>();
    const waste: CacheWaste = { missedTokens: 0, missedCost: 0, missCount: 0 };

    for (const entry of entries) {
        if (entry.kind === "pi.compaction" || entry.kind === "pi.reset") {
            previous = undefined;
            continue;
        }

        if (entry.kind !== "pi.assistant") {
            continue;
        }

        const message = entry.model?.[0] as MessageLike | undefined;
        const usage = message?.usage;

        if (usage === undefined) {
            continue;
        }

        const miss = detectMiss(previous, usage, message, cacheReadPrice);

        if (miss !== undefined) {
            misses.set(Number(entry.id), miss);
            waste.missedTokens += miss.missedTokens;
            waste.missedCost += miss.missedCost;
            waste.missCount += 1;
        }

        previous = previousOf(usage, message, previous?.reportedCache ?? false) ?? previous;
    }

    return { misses, waste };
}
