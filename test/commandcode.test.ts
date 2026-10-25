// The Command Code provider (`extensions/commandcode.ts`): its catalog, each model's wire, and its sign-in.
import { type App, cleanUp, newSession, openApp, owner, root, scriptedModel } from "./helpers.ts";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import { createHandler } from "../src/server/http.ts";

const agentDir = process.env.PI_CODING_AGENT_DIR as string;
const cachePath = join(agentDir, "commandcode-models.json");
const dataDir = join(root, "data-commandcode");

/** A catalog as the provider caches it: Claude on its own wire, and two models that answer on Responses. */
const CACHED = {
    version: 2,
    models: [
        {
            id: "claude-sonnet-5-5",
            name: "Claude Sonnet 5.5 (CC)",
            api: "anthropic-messages",
            reasoning: true,
            contextWindow: 1_000_000,
            maxTokens: 65_536,
        },
        {
            id: "gpt-5.6-sol",
            name: "GPT-5.6 Sol (CC)",
            api: "openai-responses",
            reasoning: true,
            contextWindow: 1_050_000,
            maxTokens: 65_536,
        },
        {
            id: "deepseek/deepseek-v4.1-flash",
            name: "DeepSeek V4.1 Flash (latest) (CC)",
            api: "openai-completions",
            reasoning: true,
            contextWindow: 1_000_000,
            maxTokens: 65_536,
        },
        {
            id: "minimax/minimax-m3.1-flash:free",
            name: "MiniMax M3.1 Flash (CC)",
            api: "openai-responses",
            reasoning: true,
            contextWindow: 1_000_000,
            maxTokens: 65_536,
        },
    ],
};

/** A catalog the live endpoint would answer with: one new model, and no Claude. */
const LIVE = {
    object: "list",
    data: [
        {
            id: "gpt-6-luna",
            name: "GPT-6 Luna",
            context_length: 400_000,
            supported_endpoints: ["/responses"],
        },
        {
            id: "claude-opus-5",
            name: "Claude Opus 5",
            context_length: 200_000,
            supported_endpoints: [],
        },
    ],
};

/** The account endpoints' answers, and the sign-in each request carried. */
const ACCOUNT: Record<string, unknown> = {
    "/alpha/whoami": {
        success: true,
        user: { id: "u1", name: "A person", email: "person@example.com", userName: "person" },
        org: null,
    },
    "/alpha/billing/credits": {
        credits: { monthlyCredits: 10, purchasedCredits: 0, freeCredits: 0 },
        windowLimits: {
            fiveHour: { used: 2, cap: 8, resetAt: Date.now() + 3_600_000 },
            weekly: { used: 12, cap: 40, resetAt: Date.now() + 86_400_000 },
        },
    },
    "/alpha/billing/subscriptions": {
        success: true,
        data: {
            status: "active",
            currentPeriodStart: "2026-10-01T00:00:00.000Z",
            currentPeriodEnd: "2026-11-01T00:00:00.000Z",
        },
    },
    "/alpha/usage/summary": {
        totalCount: 42,
        totalCost: 1.5,
        totalTokens: 1000,
        periodStart: "2026-10-01T00:00:00.000Z",
    },
};
const calls: { path: string; authorization: string | undefined }[] = [];
/** Whether the account's endpoints refuse the key, as an expired one does. */
let accountFails = false;

let app: App;
let server: Server;
let endpoint: string;
let origin: string;
let http: Server;
let base: string;
let guestToken: string;

before(async () => {
    // The owner signed in before: Pi keeps the credential, and the provider's last catalog sits beside it.
    writeFileSync(
        join(agentDir, "auth.json"),
        JSON.stringify({ commandcode: { type: "api_key", key: "user_test" } }),
    );
    mkdirSync(agentDir, { recursive: true });
    writeFileSync(cachePath, JSON.stringify(CACHED));

    server = createServer((request, response) => {
        const path = new URL(request.url ?? "/", "http://commandcode.test").pathname;

        calls.push({ path, authorization: request.headers.authorization });

        if (accountFails && path.startsWith("/alpha/")) {
            response.writeHead(401, { "content-type": "application/json" });
            response.end(JSON.stringify({ message: "bad key" }));

            return;
        }

        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify(ACCOUNT[path] ?? LIVE));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();

    origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? address.port : 0}`;

    endpoint = `${origin}/provider/v1/models`;
    process.env.COMMANDCODE_MODELS_CACHE = cachePath;
    process.env.COMMANDCODE_MODELS_URL = endpoint;
    process.env.COMMANDCODE_API_BASE = `${origin}/provider/v1`;
    app = await openApp(scriptedModel(), dataDir);
    guestToken = app.config.addUser("Gale", "guest").token;

    http = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(http.address() as { port: number }).port}`;
});

after(async () => {
    http?.closeAllConnections();
    http?.close();
    await app?.close();
    await new Promise<void>((resolve) => server?.close(() => resolve()));
    delete process.env.COMMANDCODE_MODELS_CACHE;
    delete process.env.COMMANDCODE_MODELS_URL;
    delete process.env.COMMANDCODE_API_BASE;
    cleanUp();
});

test("the cached catalog is registered with each model's own wire, sign-in, and price", () => {
    const provider = app.models.getProvider("commandcode");

    assert.ok(provider, "the provider is registered while the module is on");
    assert.equal(provider.name, "Command Code");
    assert.equal(
        app.models.getProviderAuthStatus("commandcode").configured,
        true,
        "the stored key counts",
    );

    const claude = app.models.getModel("commandcode", "claude-sonnet-5-5");

    assert.equal(claude?.api, "anthropic-messages");
    assert.equal(
        claude?.name,
        "Claude Sonnet 5.5",
        "the catalog's (CC) goes: the provider says it",
    );
    assert.equal(claude?.baseUrl, `${origin}/provider`, "Pi adds /v1/messages");
    assert.deepEqual(claude?.input, ["text", "image"]);
    assert.ok((claude?.thinkingLevelMap ?? {}) !== undefined);

    const sol = app.models.getModel("commandcode", "gpt-5.6-sol");

    assert.equal(sol?.api, "openai-responses");
    assert.equal(sol?.baseUrl, `${origin}/provider/v1`);
    assert.equal(
        (sol?.compat as { supportsDeveloperRole?: boolean })?.supportsDeveloperRole,
        false,
    );
    assert.equal(sol?.cost.input, 5, "the provider's table prices it");
    assert.equal(sol?.cost.tiers?.[0]?.inputTokensAbove, 272_000, "and its long-prompt tier");

    assert.equal(
        app.models.getModel("commandcode", "minimax/minimax-m3.1-flash:free")?.name,
        "MiniMax M3.1 Flash (Free)",
        "a free model says so: its paid twin has the same name",
    );

    const flash = app.models.getModel("commandcode", "deepseek/deepseek-v4.1-flash");

    assert.equal(flash?.api, "openai-completions");
    assert.equal(
        (flash?.compat as { supportsReasoningEffort?: boolean })?.supportsReasoningEffort,
        true,
    );
    assert.ok((flash?.cost.input ?? 0) > 0);
});

test("a refresh replaces the catalog from the endpoint, and writes it to the cache", async () => {
    const result = await app.providers.modelRefresh.refresh();

    assert.deepEqual(result.errors, [], "nothing failed");
    assert.ok(app.models.getModel("commandcode", "gpt-6-luna"), "the new model is there");
    assert.equal(
        app.models.getModel("commandcode", "claude-sonnet-5-5"),
        undefined,
        "the old one is gone",
    );
    assert.equal(app.models.getModel("commandcode", "gpt-6-luna")?.api, "openai-responses");
    assert.equal(app.models.getModel("commandcode", "claude-opus-5")?.api, "anthropic-messages");

    const cached = JSON.parse(await (await import("node:fs/promises")).readFile(cachePath, "utf8"));

    assert.deepEqual(cached.models.map((model: { id: string }) => model.id).sort(), [
        "claude-opus-5",
        "gpt-6-luna",
    ]);
});

test("/commandcode-quota shows the account's credits, and never its login", async () => {
    const id = await newSession(app);
    const command = app.webs.commands().find((each) => each.name === "commandcode-quota");

    assert.ok(command, "the module adds the command");
    assert.equal(command.scope, "global", "the owner's alone");

    const receipt = await app.extensionCommands.run(id, owner(app), {
        commandId: command.id,
        args: "",
        requestId: crypto.randomUUID(),
    });

    assert.equal(receipt.status, "done");
    assert.equal(receipt.type, "card");

    const output = String((receipt as { output?: string }).output);

    assert.match(output, /Credits/);
    assert.match(output, /5-hour/);
    assert.match(output, /Usage windows/);
    assert.ok(!output.includes("person@example.com"), "the account's login stays out of the card");
    assert.ok(
        calls.some(
            (call) =>
                call.path === "/alpha/billing/credits" && call.authorization === "Bearer user_test",
        ),
        "the stored key went to the account endpoints",
    );
});

/** A request as someone, with the `X-Pocket` header the app asks for. */
async function call(
    token: string,
    path: string,
    { method = "GET", body }: { method?: string; body?: unknown } = {},
) {
    const response = await fetch(`${base}${path}`, {
        method,
        headers: {
            authorization: `Bearer ${token}`,
            "x-pocket": "1",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    return { status: response.status, data: (await response.json()) as Record<string, unknown> };
}

const alphaCalls = () => calls.filter((call) => call.path.startsWith("/alpha/")).length;

test("the usage route answers the owner, and one read serves the menu for a moment", async () => {
    const ownerToken = app.config.ownerToken;
    const before = alphaCalls();
    const fresh = await call(ownerToken, "/api/x/commandcode/usage", {
        method: "POST",
        body: { fresh: true },
    });

    assert.equal(fresh.status, 200);
    assert.equal(alphaCalls() - before, 4, "a fresh read asks the account's four endpoints");
    assert.equal(typeof fresh.data.remaining, "number");
    assert.equal(typeof fresh.data.pool, "number");
    assert.equal(fresh.data.plan, "active");
    assert.deepEqual((fresh.data.windows as { id: string }[]).map((window) => window.id).sort(), [
        "fiveHour",
        "weekly",
    ]);

    const again = await call(ownerToken, "/api/x/commandcode/usage");

    assert.equal(again.status, 200);
    assert.equal(alphaCalls() - before, 4, "a read just after answers from the one before");
    assert.deepEqual(again.data, fresh.data);

    // A read that fails changes nothing that worked, and says why.
    accountFails = true;

    const failed = await call(ownerToken, "/api/x/commandcode/usage", {
        method: "POST",
        body: { fresh: true },
    });

    assert.equal(failed.status, 502);
    assert.match(String(failed.data.error ?? failed.data.message), /401/);
    accountFails = false;

    const kept = await call(ownerToken, "/api/x/commandcode/usage");

    assert.equal(kept.status, 200, "the last good numbers stay for the moment");
    assert.deepEqual(kept.data, fresh.data);
});

test("the usage route and the menu are the owner's alone", async () => {
    assert.equal((await call(guestToken, "/api/x/commandcode/usage")).status, 404);
    assert.equal(
        (await call(guestToken, "/api/x/commandcode/usage", { method: "POST", body: {} })).status,
        404,
    );

    const ownerUi = (await call(app.config.ownerToken, "/api/me")).data as {
        server: { ui: { module: string }[] };
    };

    assert.ok(ownerUi.server.ui.some((module) => module.module === "commandcode"));

    const guestUi = (await call(guestToken, "/api/me")).data as {
        server: { ui: { module: string }[] };
    };

    assert.ok(!guestUi.server.ui.some((module) => module.module === "commandcode"));
});

test("turning the module off takes the provider out of Pi", async () => {
    await app.setExtensionEnabled(owner(app), "commandcode.ts", false);
    assert.equal(app.models.getProvider("commandcode"), undefined);

    await app.setExtensionEnabled(owner(app), "commandcode.ts", true);
    assert.ok(app.models.getModel("commandcode", "gpt-6-luna"), "back with its catalog");
});
