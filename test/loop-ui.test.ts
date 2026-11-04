// Loop's status line in a real Chromium: a loop says so under the message box, its sheet shows the aim and ends it, and
// the item goes when the loop does.
import {
    type App,
    cleanUp,
    context,
    newSession,
    openApp,
    owner,
    root,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ConversationId } from "@earendil-works/pi-durable";
import { Browsers } from "../src/server/browser.ts";
import { findBrowser } from "../src/server/browser/discovery.ts";
import type { BrowserPage } from "../src/server/browser/page.ts";
import { createHandler } from "../src/server/http.ts";
import { LoopDoc } from "../src/server/extensions/loop.ts";

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

const item = 'button.ext-status[data-module="loop"]';

before(async () => {
    if (chromium === undefined) {
        return;
    }

    app = await openApp(scriptedModel());
    session = await newSession(app);
    server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    browsers = new Browsers({
        dataDir: mkdtempSync(join(root, "loop-ui-")),
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

test("a loop shows in the status line, and its sheet stops it", real, async () => {
    await page.navigate(`${base}/s/${String(session)}`);
    await until(() => has(".composer"), "the message box");
    assert.equal(await has(item), false, "no loop, no item");

    const command = app.webs.commands().find((each) => each.name === "loop-on");

    assert.ok(command, "the module adds /loop-on");

    await app.extensionCommands.run(session, owner(app), {
        commandId: command.id,
        args: "make it better",
        requestId: crypto.randomUUID(),
    });

    await until(() => has(item), "the loop in the status line", 15_000);
    // The line shows the long words on a wide screen, and `short` on a narrow one.
    assert.equal(
        await inPage<string>(
            `return JSON.stringify(document.querySelector(${JSON.stringify(item)} + " .long").textContent.trim())`,
        ),
        "∞ loop",
    );
    assert.equal(
        await inPage<string>(
            `return JSON.stringify(document.querySelector(${JSON.stringify(item)} + " .short").textContent.trim())`,
        ),
        "∞",
    );

    // The tab hears the loop's own news, not only the server's answer to a question.
    await page.click({ selector: item });
    await until(
        async () =>
            (await inPage<string>(
                `return JSON.stringify(document.querySelector(".sheet .loop-sheet-goal")?.textContent.trim() ?? "")`,
            )) === "make it better",
        "the loop's sheet",
    );
    // The sheet is open; its buttons take a click at once, as a tap does.
    await new Promise((resolve) => setTimeout(resolve, 450));

    await inPage<null>(
        `const button = [...document.querySelectorAll(".sheet button")].find((each) => each.textContent.trim().startsWith("Stop the loop"));
        button.click();
        return "null";`,
    );

    await until(
        async () => (await app.harness.snapshot(LoopDoc, session, context))?.on === undefined,
        "the loop to end",
    );
    await until(async () => !(await has(item)), "the item to go", 15_000);
});
