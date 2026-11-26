// A cache miss in the chat, in a real Chromium: the answer that paid it says what was billed again, and the
// Appearance switch hides it (`web/transcript.js`, `web/turns.js`, `web/theme.js`).
import {
    type App,
    cleanUp,
    context,
    newSession,
    openApp,
    root,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { Usage } from "@earendil-works/pi-ai";
import { fauxAssistantMessage } from "@earendil-works/pi-ai/providers/faux";
import type { ConversationId } from "@earendil-works/pi-durable";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import type { BrowserPage } from "../src/server/browser/page.ts";
import { createHandler } from "../src/server/http.ts";

const chromium = findBrowser();
const real = {
    skip: chromium === undefined ? "no Chromium-based browser on this machine" : false,
} as const;
const DESKTOP = { width: 1440, height: 900, scale: 1, mobile: false };

let app: App;
let server: Server;
let browsers: Browsers;
let page: BrowserPage;
let base = "";
let session: ConversationId;

async function inPage<T>(script: string): Promise<T> {
    return JSON.parse(await page.evaluate(script)) as T;
}

const has = (selector: string) =>
    inPage<boolean>(
        `return JSON.stringify(document.querySelector(${JSON.stringify(selector)}) !== null)`,
    );

const text = (selector: string) =>
    inPage<string>(
        `return JSON.stringify(document.querySelector(${JSON.stringify(selector)})?.textContent.trim() ?? "")`,
    );

const at = (seconds: number) => 1_000_000 + seconds * 1_000;

/** An answer as Pi Durable keeps it, with the usage its request billed. */
async function answer(id: ConversationId, usage: Usage, timestamp: number): Promise<void> {
    const message = { ...fauxAssistantMessage("done"), timestamp, usage };

    await app.harness.commit(async (tx) => {
        await tx.appendEntry(id, { kind: "pi.assistant", model: [message] });
    }, context);
}

before(async () => {
    if (chromium === undefined) {
        return;
    }

    app = await openApp(scriptedModel());
    session = await newSession(app, root);
    // A cache write of 100k at $37.50/M, then 7 minutes later the same prompt as input at $30/M.
    await answer(
        session,
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
        session,
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

    server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    browsers = new Browsers({
        dataDir: mkdtempSync(join(root, "cache-waste-ui-")),
        load: async () => undefined,
        save: () => {},
    });
    page = await browsers.open(1);
    await page.setViewport(DESKTOP);
    await page.navigate(`${base}/login?token=${encodeURIComponent(app.config.ownerToken)}`);
});

after(async () => {
    await browsers?.closeAll({ final: true });
    server?.closeAllConnections();
    server?.close();
    await app?.close();
    cleanUp();
});

test(
    "a cache miss shows under the answer that paid it, until Appearance turns it off",
    real,
    async () => {
        await page.navigate(`${base}/s/${String(session)}`);
        await until(() => has(".reply .cache-miss"), "the cache miss");

        assert.equal(
            await text(".reply .cache-miss"),
            "Cache miss after 7m idle: 100k tokens re-billed (~$3.00)",
        );

        // This browser's own choice, as Appearance writes it: the line goes, and the answer stays.
        await inPage(
            `const saved = JSON.parse(localStorage.getItem("pocket.appearance") ?? "{}");
        localStorage.setItem("pocket.appearance", JSON.stringify({ ...saved, cacheMiss: false }));
        return "null";`,
        );
        await page.reload();
        await until(() => has(".reply"), "the answer");
        await new Promise((resolve) => setTimeout(resolve, 250));

        assert.equal(await has(".reply .cache-miss"), false);
    },
);
