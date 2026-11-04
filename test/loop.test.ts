// Loop: Pi takes the next round by itself until a person stops it, and Stop or /loop-off ends the loop.
import { LoopDoc } from "../src/server/extensions/loop.ts";
import {
    type App,
    cleanUp,
    context,
    lastText,
    newSession,
    openApp,
    owner,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import type { ConversationId } from "@earendil-works/pi-durable";
import type { FauxResponseStep } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxText } from "@earendil-works/pi-ai/providers/faux";

/** Pi answers in words only: every round is one answer, which the loop goes on from. */
const route: FauxResponseStep = (request) => {
    const { text } = lastText(request as never);

    return fauxAssistantMessage([fauxText(`answered: ${text.slice(0, 40)}`)]);
};

const model = scriptedModel(route);
let app: App;

before(async () => {
    app = await openApp(model);
});

after(async () => {
    await app?.close();
    cleanUp();
});

const commandId = (name: string): string => {
    const found = app.webs.commands().find((each) => each.name === name);

    assert.ok(found, `the module adds /${name}`);

    return found.id;
};

async function run(id: ConversationId, name: string, args = "") {
    return app.extensionCommands.run(id, owner(app), {
        commandId: commandId(name),
        args,
        requestId: crypto.randomUUID(),
    });
}

/** The rounds Pi went on with: each is a message of the loop's. */
async function rounds(id: ConversationId): Promise<number> {
    const page = await (await app.harness.conversation(id, context))!.entries(
        {},
        500,
        undefined,
        context,
    );

    return page.items
        .filter((entry) => entry.kind === "pi.user")
        .map((entry) => JSON.stringify(entry.model))
        .filter((text) => text.includes("[loop] ")).length;
}

async function loopOf(id: ConversationId) {
    return (await app.harness.snapshot(LoopDoc, id, context))?.on;
}

test("a loop takes round after round by itself, and a person's stop ends it", async () => {
    const id = await newSession(app);
    const command = app.webs.commands().find((each) => each.name === "loop-on");

    assert.equal(command?.scope, "conversation", "the people who steer the session start it");

    const started = await run(id, "loop-on", "make it better");

    assert.equal(started.type, "card");
    assert.match(String((started as { output?: string }).output), /Loop on: make it better/);

    // The first round comes from the command, the others from Pi's answer: no person sends anything.
    await until(async () => (await rounds(id)) >= 3, "three rounds by themselves", 30_000);
    assert.equal((await loopOf(id))?.goal, "make it better");

    await app.commands.abort(id, owner(app));
    await until(
        async () => (await loopOf(id)) === undefined,
        "the loop to end after the stop",
        30_000,
    );

    const count = await rounds(id);

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.equal(await rounds(id), count, "no round after the stop");
});

test("/loop-off ends the loop after the current answer", async () => {
    const id = await newSession(app);

    await run(id, "loop-on", "keep at it");
    await until(async () => (await rounds(id)) >= 1, "the first round", 30_000);

    const ended = await run(id, "loop-off");

    assert.equal(ended.type, "toast");
    await until(async () => (await loopOf(id)) === undefined, "the loop to be off");

    const count = await rounds(id);

    await new Promise((resolve) => setTimeout(resolve, 2_000));
    assert.equal(await rounds(id), count, "no round after /loop-off");
});

test("the status line's route says what the loop is, and the people who steer end it", async () => {
    const { createServer } = await import("node:http");
    const { createHandler } = await import("../src/server/http.ts");
    const server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

    const call = async (token: string, path: string, body?: unknown) => {
        const response = await fetch(`${base}/api/x/loop/${path}`, {
            method: body === undefined ? "GET" : "POST",
            headers: {
                authorization: `Bearer ${token}`,
                "x-pocket": "1",
                "content-type": "application/json",
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });

        return { status: response.status, data: (await response.json()) as Record<string, any> };
    };

    try {
        const id = await newSession(app);

        await run(id, "loop-on", "make it better");
        // Pi's run would go on by itself: the loop's own round is all this test needs.
        await app.commands.abort(id, owner(app));

        const seen = await call(app.config.ownerToken, `loop?conversation=${String(id)}`);

        assert.equal(seen.status, 200);
        assert.equal(seen.data.on.goal, "make it better", "the status line's words are the loop's");
        assert.equal(typeof seen.data.on.at, "number");

        const viewer = app.config.addUser("Val", "viewer").token;

        assert.equal(
            (await call(viewer, "loop/stop", { conversation: id, off: true })).status,
            404,
            "a viewer ends no loop",
        );
        assert.equal((await loopOf(id))?.goal, "make it better");

        const stopped = await call(app.config.ownerToken, "loop/stop", {
            conversation: id,
            off: true,
        });

        assert.equal(stopped.status, 200);
        assert.equal(stopped.data.on, null);
        assert.equal(await loopOf(id), undefined, "the sheet's Stop ends the loop");
    } finally {
        server.close();
    }
});

test("/loop-off on a session without a loop says so, and changes nothing", async () => {
    const id = await newSession(app);
    const ended = await run(id, "loop-off");

    assert.equal(ended.type, "toast");
    assert.equal(await loopOf(id), undefined);
});
