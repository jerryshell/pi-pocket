// Deleting an artifact: every version, its saved state, design notes, and share links, over the route and in the app.
import {
    type App,
    cleanUp,
    context,
    openApp,
    owner,
    root,
    scriptedModel,
    until,
    work,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ConversationId } from "@earendil-works/pi-durable";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import {
    ArtifactAssetDoc,
    ArtifactBodyDoc,
    ArtifactStateDoc,
    ArtifactsDoc,
    DesignCommentsDoc,
} from "../src/server/docs.ts";
import createArtifacts from "../src/server/extensions/artifacts.ts";
import type { PocketHost } from "../src/server/host.ts";
import { createHandler } from "../src/server/http.ts";

let app: App;
let server: Server;
let base: string;
let calls = 0;

before(async () => {
    app = await openApp(scriptedModel());
    app.config.lastModel ??= { provider: "faux", modelId: "faux-1", thinkingLevel: "off" };
    server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

after(async () => {
    server?.closeAllConnections();
    server?.close();
    await app?.close();
    cleanUp();
});

async function newSession(): Promise<ConversationId> {
    const { id } = await app.commands.createSession(owner(app), { cwd: work });

    return id;
}

async function publish(session: ConversationId, args: Record<string, unknown>) {
    return createArtifacts({} as PocketHost).tools![0]!.execute(
        args as never,
        {
            conversationId: session,
            taskId: 9000 + (calls += 1),
            callId: "publish",
            agent: async () => ({ cwd: work }),
            snapshot: app.harness.snapshot.bind(app.harness),
            commit: app.harness.commit.bind(app.harness),
        } as never,
        context,
    );
}

/** Delete as the person with `token`: the status and the JSON. */
async function remove(token: string, session: ConversationId, artifact: string) {
    const response = await fetch(
        `${base}/api/c/${session}/artifacts/${encodeURIComponent(artifact)}`,
        {
            method: "DELETE",
            headers: { authorization: `Bearer ${token}`, "x-pocket": "1" },
        },
    );

    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
}

test("delete takes every version, state, design notes, and links, and leaves the other artifacts", async () => {
    const session = await newSession();
    const other = await newSession();
    const asset = createHash("sha256").update("hello").digest("hex");

    await publish(session, {
        id: "demo",
        title: "Demo",
        content: "<p>one</p>",
        assets: [{ name: "note.txt", content: "hello" }],
    });
    await publish(session, { id: "demo", title: "Demo", content: "<p>two</p>" });
    await publish(session, { id: "other", title: "Other", content: "<p>other</p>" });
    await publish(other, { id: "demo", title: "Elsewhere", content: "<p>elsewhere</p>" });

    await app.harness.commit(async (tx) => {
        const states = await tx.doc(ArtifactStateDoc, session);

        states.items.demo = {
            [owner(app).id]: { value: { open: true }, at: 1 },
        };

        const designs = await tx.doc(DesignCommentsDoc, session);

        designs.items.demo = { comments: [] };
    }, context);

    const share = await app.shares.create(session, owner(app), { id: "demo" });
    const result = await remove(app.config.ownerToken, session, "demo");

    assert.equal(result.status, 200);
    assert.deepEqual(result.json, { ok: true });

    // Every version's page is gone: the route, the store, and retried requests say so.
    await assert.rejects(app.artifactBody(session, "demo"), /No such artifact/);
    assert.equal(
        await app.harness.snapshot(ArtifactBodyDoc, session, "demo@1", context),
        undefined,
    );
    assert.equal(
        await app.harness.snapshot(ArtifactBodyDoc, session, "demo@2", context),
        undefined,
    );
    assert.equal((await remove(app.config.ownerToken, session, "demo")).status, 404);

    // What its pages saved and Design kept for it goes too, so the id starts clean if it comes back.
    const states = await app.harness.snapshot(ArtifactStateDoc, session, context);

    assert.equal(states?.items.demo, undefined);

    const designs = await app.harness.snapshot(DesignCommentsDoc, session, context);

    assert.equal(designs?.items.demo, undefined);

    // Its links are ended, not left to count toward the session's limit.
    assert.deepEqual(await app.shares.list(session, owner(app)), []);

    const published = await fetch(`${base}${share.path}`);

    assert.equal(published.status, 404);

    // Its bytes stay: they are addressed by content, and another artifact may use the same ones.
    assert.notEqual(await app.harness.snapshot(ArtifactAssetDoc, asset, context), undefined);

    // The same id in another session, and the other artifact here, are untouched.
    assert.equal((await app.artifactBody(other, "demo")).content, "<p>elsewhere</p>");
    assert.equal((await app.artifactBody(session, "other")).content, "<p>other</p>");

    const items = (await app.harness.snapshot(ArtifactsDoc, session, context))?.items;

    assert.deepEqual(Object.keys(items ?? {}), ["other"]);

    const list = await app.artifactOverview(owner(app));

    assert.ok(!list.some((entry) => entry.session === Number(session) && entry.id === "demo"));
    assert.ok(list.some((entry) => entry.session === Number(session) && entry.id === "other"));
});

test("only someone who steers deletes, and a missing or unshared artifact is not found", async () => {
    const session = await newSession();
    const elsewhere = await newSession();

    await publish(session, { id: "demo", title: "Demo", content: "<p>demo</p>" });

    const viewer = app.config.addUser("Viewer", "viewer", [String(session)]).token;

    assert.equal((await remove(viewer, session, "demo")).status, 403);

    const stranger = app.config.addUser("Stranger", "guest", [String(elsewhere)]).token;

    assert.equal((await remove(stranger, session, "demo")).status, 404);
    assert.equal((await remove(app.config.ownerToken, session, "missing")).status, 404);

    // A viewer's refusal left it there.
    assert.equal((await app.artifactBody(session, "demo")).content, "<p>demo</p>");
});

test(
    "All artifacts has a trash button for each row that deletes it after a confirmation",
    { skip: findBrowser() === undefined ? "no Chromium-based browser on this machine" : false },
    async () => {
        const session = await newSession();

        await publish(session, { id: "trash-me", title: "Trash me", content: "<p>gone</p>" });

        const browsers = new Browsers({
            dataDir: mkdtempSync(join(root, "artifact-delete-ui-")),
            load: async () => undefined,
            save: () => {},
        });

        try {
            const page = await browsers.open(1);
            const inPage = async <T>(script: string) =>
                JSON.parse(await page.evaluate(script)) as T;

            await page.navigate(`${base}/login?token=${encodeURIComponent(app.config.ownerToken)}`);
            await page.navigate(`${base}/s/${session}`);
            await until(
                async () =>
                    await inPage<boolean>(
                        `return JSON.stringify(document.querySelector(".composer") !== null)`,
                    ),
                "the session",
            );
            await inPage(
                `(await import("/store.js")).openSheet({ type: "all-artifacts" }); return "null"`,
            );
            await until(
                async () =>
                    await inPage<boolean>(
                        `return JSON.stringify(document.querySelector(".overview-delete") !== null)`,
                    ),
                "the row's delete button",
            );

            // The page's confirm is accepted by itself (a headless page cannot answer one).
            await inPage(`document.querySelector(".overview-delete").click(); return "null"`);
            await until(
                async () =>
                    !(await app.artifactOverview(owner(app))).some(
                        (entry) => entry.session === Number(session),
                    ),
                "the deletion",
            );

            const stillListed = async () =>
                await inPage<boolean>(`
                    return JSON.stringify([...document.querySelectorAll(".overview-row")].some((row) => row.textContent.includes("Trash me")));
                `);

            await until(async () => !(await stillListed()), "the row to go");

            assert.equal(await stillListed(), false);
            assert.equal(
                await app.artifactBody(session, "trash-me").catch(() => undefined),
                undefined,
            );
        } finally {
            await browsers.closeAll({ final: true });
        }
    },
);
