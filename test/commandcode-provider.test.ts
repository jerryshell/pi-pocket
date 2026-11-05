// The vendored Command Code provider's own units (`src/server/commandcode/`): the sign-in callback's origin and
// state, how a pasted key is validated, where credentials are read, and the prices upstream 0.7.12 added.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, test } from "node:test";
import { getConfiguredApiKey } from "../src/server/commandcode/api-key.ts";
import { startAuthServer } from "../src/server/commandcode/auth-server.ts";
import { validateApiKey, validationApiBase } from "../src/server/commandcode/oauth.ts";
import { MODEL_COSTS, PRICING_LAST_VERIFIED } from "../src/server/commandcode/pricing.ts";

const folders: string[] = [];

function tempFolder(): string {
    const folder = mkdtempSync(join(tmpdir(), "pi-pocket-commandcode-"));

    folders.push(folder);

    return folder;
}

after(() => {
    for (const folder of folders) {
        rmSync(folder, { force: true, recursive: true });
    }
});

/** An auth file as pi writes it: {"commandcode": {"type": "api", "key": "..."}}. */
function writeCredentials(path: string, key: string): void {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify({ commandcode: { type: "api", key } }));
}

interface Asked {
    url: string;
    authorization: string | undefined;
}

/** A fetch that answers at once, and remembers what it was asked. */
function answer(status: number, asked: Asked[]): typeof fetch {
    return (async (input: string | URL | Request, init?: RequestInit) => {
        const headers = new Headers(init?.headers);

        asked.push({
            url: String(input),
            authorization: headers.get("authorization") ?? undefined,
        });

        return new Response("{}", { status });
    }) as unknown as typeof fetch;
}

async function post(port: number, body: unknown, origin?: string): Promise<number> {
    const response = await fetch(`http://127.0.0.1:${port}/callback`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            ...(origin === undefined ? {} : { Origin: origin }),
        },
        body: JSON.stringify(body),
    });

    await response.arrayBuffer();

    return response.status;
}

function close(auth: { server: { listening: boolean; close: () => unknown } }): void {
    if (auth.server.listening) {
        auth.server.close();
    }
}

test("the prices carry the stealth preview, and the dated Ling preview's list rates", () => {
    assert.equal(PRICING_LAST_VERIFIED, "2026-11-04");
    assert.deepEqual(MODEL_COSTS["stealth/crouton-alpha"], {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
    });
    assert.deepEqual(MODEL_COSTS["inclusionai/ling-3.1-flash-1019"], {
        input: 0.3,
        output: 0.9,
        cacheRead: 0.06,
        cacheWrite: 0,
    });
    assert.equal(
        MODEL_COSTS["inclusionai/ling-3.1-flash-1019:free"],
        undefined,
        "the retired free entry is gone",
    );
});

test("credentials come from the pi profile the environment names, and not from the default one", () => {
    const home = tempFolder();
    const profile = join(home, "profile");

    writeCredentials(join(home, ".pi", "agent", "auth.json"), "default-profile");
    writeCredentials(join(profile, "auth.json"), "named-profile");

    assert.equal(
        getConfiguredApiKey({ env: { PI_CODING_AGENT_DIR: profile }, homeDir: () => home }),
        "named-profile",
    );
    assert.equal(
        getConfiguredApiKey({
            env: { PI_CODING_AGENT_DIR: join(home, "empty") },
            homeDir: () => home,
        }),
        undefined,
        "a named profile does not fall back to another profile's key",
    );
    assert.equal(getConfiguredApiKey({ env: {}, homeDir: () => home }), "default-profile");
});

test("the Command Code CLI's own credentials still resolve from the home folder", () => {
    const home = tempFolder();

    writeCredentials(join(home, ".pi", "agent", "auth.json"), "default-profile");
    writeCredentials(join(home, ".commandcode", "auth.json"), "cli-profile");

    assert.equal(
        getConfiguredApiKey({
            env: { PI_CODING_AGENT_DIR: join(home, "empty") },
            homeDir: () => home,
        }),
        "cli-profile",
    );
});

test("key validation goes to the base beside the configured Provider API base", () => {
    assert.equal(
        validationApiBase({ COMMANDCODE_API_BASE: "https://gateway.example/provider/v1" }),
        "https://gateway.example",
    );
    assert.equal(
        validationApiBase({ COMMANDCODE_API_BASE: "https://gateway.example/provider/v1/" }),
        "https://gateway.example",
    );
    assert.equal(validationApiBase({}), "https://api.commandcode.ai");
});

test("a pasted key is validated against the configured base, with the key", async () => {
    const asked: Asked[] = [];
    const previous = process.env.COMMANDCODE_API_BASE;

    process.env.COMMANDCODE_API_BASE = "https://gateway.example/provider/v1";

    try {
        await validateApiKey("user_abc", { fetchImpl: answer(200, asked) });
    } finally {
        if (previous === undefined) {
            delete process.env.COMMANDCODE_API_BASE;
        } else {
            process.env.COMMANDCODE_API_BASE = previous;
        }
    }

    assert.deepEqual(asked, [
        { url: "https://gateway.example/alpha/whoami", authorization: "Bearer user_abc" },
    ]);
});

test("a key the account no longer holds is reported as invalid", async () => {
    await assert.rejects(validateApiKey("user_stale", { fetchImpl: answer(401, []) }), {
        message: "Invalid Command Code API key",
    });
});

test("a whoami that stalls stops at the deadline, even when fetch ignores the abort", async () => {
    const stalled = (() => new Promise<Response>(() => {})) as unknown as typeof fetch;
    const started = Date.now();

    await assert.rejects(validateApiKey("user_abc", { fetchImpl: stalled, timeoutMs: 20 }), {
        message: "Could not validate the Command Code API key: request timed out after 20ms",
    });
    assert.ok(Date.now() - started < 5_000, "the deadline ends the wait");
});

test("the callback refuses a local development origin", async () => {
    const auth = await startAuthServer({ startPort: 0, expectedState: "state-1" });

    auth.waitForCallback.catch(() => {});

    try {
        assert.equal(
            await post(
                auth.port,
                { state: "state-1", error: "access_denied" },
                "http://localhost:3000",
            ),
            403,
        );
    } finally {
        close(auth);
    }
});

test("only the callback that holds the state token settles the sign-in", async () => {
    const auth = await startAuthServer({ startPort: 0, expectedState: "state-2" });
    let settled = false;

    auth.waitForCallback.then(
        () => {
            settled = true;
        },
        () => {
            settled = true;
        },
    );

    try {
        assert.equal(
            await post(auth.port, { state: "spoofed", error: "access_denied" }),
            403,
            "an error from another page is refused",
        );
        assert.equal(settled, false, "and leaves the sign-in waiting");

        assert.equal(
            await post(auth.port, {
                state: "state-2",
                apiKey: "user_key",
                userId: "user-1",
                userName: "Owner",
                keyName: "laptop",
            }),
            200,
        );

        const callback = await auth.waitForCallback;

        assert.deepEqual(callback, {
            apiKey: "user_key",
            state: "state-2",
            userId: "user-1",
            userName: "Owner",
            keyName: "laptop",
        });
    } finally {
        close(auth);
    }
});
