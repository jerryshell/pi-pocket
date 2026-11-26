import {
    cleanUp,
    context,
    newSession,
    openApp,
    owner,
    root,
    say,
    scriptedModel,
    until,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";
import { after, before, test } from "node:test";
import type { ConversationId } from "@earendil-works/pi-durable";
import { DeletedDoc, SessionsDoc, SpendDoc } from "../src/server/docs.ts";
import { createHandler } from "../src/server/http.ts";

const dataDir = join(root, "data");
const repo = join(root, "repo");
let app: Awaited<ReturnType<typeof openApp>>;
let server: Server;
let base = "";
let guest = "";
const gitIn = (cwd: string, ...args: string[]) =>
    execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

async function start(): Promise<void> {
    app = await openApp(scriptedModel(), dataDir);
    server = createServer(
        createHandler({ app, listen: { host: "127.0.0.1", port: 0 }, restart: () => {} }),
    );
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
}

async function stop(): Promise<void> {
    server.closeAllConnections();
    server.close();
    await app.close();
}

before(async () => {
    mkdirSync(repo, { recursive: true });
    gitIn(repo, "init", "-q");
    gitIn(repo, "config", "core.autocrlf", "false");
    gitIn(repo, "config", "user.email", "t@example.com");
    gitIn(repo, "config", "user.name", "T");
    writeFileSync(join(repo, "main.ts"), "export const answer = 1;\n");
    gitIn(repo, "add", "-A");
    gitIn(repo, "commit", "-qm", "init");
    await start();
    guest = app.config.addUser("Gale", "guest").token;
});

after(async () => {
    await stop();
    cleanUp();
});

async function call(path: string, body?: unknown, token = app.config.ownerToken) {
    const response = await fetch(`${base}${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
            authorization: `Bearer ${token}`,
            "x-pocket": "1",
            ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

    return { status: response.status, data: (await response.json()) as Record<string, any> };
}

async function worktreeSession(title: string): Promise<ConversationId> {
    const { id } = await app.commands.createSession(owner(app), {
        cwd: repo,
        title,
        worktree: true,
    });

    await app.commands.configure(id, owner(app), {
        model: { provider: "faux", modelId: "faux-1" },
        thinkingLevel: "off",
    });

    return id;
}

function filesOf(id: ConversationId): { uploads: string; logs: string } {
    const uploads = join(dataDir, "uploads", String(id));
    const logs = join(dataDir, "background", String(id));

    mkdirSync(uploads, { recursive: true });
    mkdirSync(logs, { recursive: true });
    writeFileSync(join(uploads, "photo.png"), "x".repeat(2048));
    writeFileSync(join(logs, "abc.log.aaaaaa"), "output\n");

    return { uploads, logs };
}

/**
 * What the SQLite file holds for a conversation: the rows Pi Durable has no call to delete, which the removal takes
 * with it (`purge.ts`), and its spend record.
 */
function storedRows(id: ConversationId, data = dataDir) {
    const db = new DatabaseSync(join(data, "pocket.sqlite"), { readOnly: true });

    try {
        const count = (table: string, column: string) =>
            (
                db
                    .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
                    .get(Number(id)) as { n: number }
            ).n;

        return {
            conversations: count("conversations", "id"),
            entries: count("entries", "conversation_id"),
            tasks: count("tasks", "conversation_id"),
            submissions: count("submissions", "conversation_id"),
            documents: count("documents", "owner_id"),
            recordIds: count("record_ids", "id"),
        };
    } finally {
        db.close();
    }
}

const noRows = {
    conversations: 0,
    entries: 0,
    tasks: 0,
    submissions: 0,
    documents: 0,
    recordIds: 0,
};

/** A conversation's stored record, as SQLite keeps it: where a fork's parent link lives. */
function conversationRecord(id: ConversationId): Record<string, unknown> {
    const db = new DatabaseSync(join(dataDir, "pocket.sqlite"), { readOnly: true });

    try {
        const row = db.prepare("SELECT record FROM conversations WHERE id = ?").get(Number(id)) as
            { record: string } | undefined;

        if (row === undefined) {
            throw new Error(`No conversation ${id}`);
        }

        return JSON.parse(row.record) as Record<string, unknown>;
    } finally {
        db.close();
    }
}

const archive = (id: ConversationId) =>
    app.commands.updateSession(id, owner(app), { archived: true });

test("an archived session leaves the app with its files and its rows; a guest cannot", async () => {
    const id = await worktreeSession("Old work");
    const other = await newSession(app);
    const worktree = app.sessionMeta(id)!.worktree!;
    const files = filesOf(id);
    const removed: number[] = [];

    app.events.on("session.removed", (event) => removed.push(event.conversationId));
    await say(app, id, "hello");
    await app.schedules.add(id, { when: "in 30m", text: "later" });

    const early = await call("/api/x/session-cleanup/remove", { ids: [id] });

    assert.equal(early.data.outcomes[0].done, false);
    assert.match(early.data.outcomes[0].why, /Archive it first/);

    await archive(id);
    assert.equal((await call("/api/x/session-cleanup/plan", { ids: [id] }, guest)).status, 404);
    assert.equal((await call("/api/x/session-cleanup/remove", { ids: [id] }, guest)).status, 404);

    const [plan] = (await call("/api/x/session-cleanup/plan", { olderThanDays: 0 })).data.sessions;

    assert.equal(plan.id, id);
    assert.equal(plan.blocked, undefined);
    assert.equal(plan.worktree.state, "clean");
    assert.equal(plan.uploads.bytes, 2048);
    assert.equal(plan.ends.schedules, 1);

    assert.equal((await call(`/api/c/${id}/trust`)).status, 200);
    const done = await call("/api/x/session-cleanup/remove", { ids: [id] });

    assert.equal(done.data.outcomes[0].done, true);
    assert.ok(done.data.outcomes[0].bytes >= 2048);
    assert.deepEqual(
        app.sessions().map((session) => session.id),
        [other],
        "it left the list; the other session stays",
    );
    assert.equal((await call(`/api/c/${id}/trust`)).status, 404, "nobody opens it again");
    assert.equal(existsSync(files.uploads), false);
    assert.equal(existsSync(files.logs), false);
    assert.equal(existsSync(worktree.path), false);
    assert.match(gitIn(repo, "branch", "--list", worktree.branch), /pocket\//, "the branch stays");
    assert.deepEqual(await app.schedules.list(id), [], "its schedule ended");
    assert.deepEqual(removed, [Number(id)]);

    const record = (await app.harness.snapshot(DeletedDoc, context))!.items[String(id)]!;

    assert.ok(record.done !== undefined, "it is done, so no restart runs it again");
    assert.ok(record.conversations.includes(Number(id)));
    assert.deepEqual(storedRows(id), noRows, "its transcript, tasks, and documents go with it");
    assert.equal(
        (await app.harness.snapshot(SpendDoc, context))?.counted[String(id)],
        undefined,
        "and its spend record",
    );
});

test("uncommitted changes in its worktree keep a session; a live fork keeps the uploads it reads", async () => {
    const dirty = await worktreeSession("Dirty");

    writeFileSync(join(app.sessionMeta(dirty)!.worktree!.path, "wip.ts"), "unsaved\n");
    await archive(dirty);

    const [kept] = (await call("/api/x/session-cleanup/remove", { ids: [dirty] })).data.outcomes;

    assert.equal(kept.done, false);
    assert.match(kept.why, /uncommitted changes/);
    assert.ok(app.sessionMeta(dirty) !== undefined);

    // A fork of a fork stays: removing its parent and grandparent together keeps the grandparent's uploads, which it
    // still reads through the removed parent.
    const grand = await newSession(app);

    await say(app, grand, "hello");
    const forkOf = async (id: ConversationId) =>
        (
            await app.commands.fork(id, owner(app), {
                entryId: (await app.transcripts.allEntries(id, false)).at(-1)!.id,
            })
        ).id;
    const parent = await forkOf(grand);
    const child = await forkOf(parent);
    const grandFiles = filesOf(grand);
    const parentFiles = filesOf(parent);
    const inherited = (await app.transcripts.allEntries(child, false)).map((entry) => entry.id);

    await archive(grand);
    await archive(parent);
    const outcomes = (await call("/api/x/session-cleanup/remove", { ids: [grand, parent] })).data
        .outcomes;

    assert.deepEqual(
        outcomes.map((outcome: { id: number; done: boolean }) => [outcome.id, outcome.done]),
        [
            [grand, true],
            [parent, true],
        ],
    );
    assert.equal(existsSync(grandFiles.uploads), true, "the fork still shows them");
    assert.equal(existsSync(parentFiles.uploads), true);
    assert.equal(existsSync(grandFiles.logs), false);
    assert.ok(app.sessionMeta(child) !== undefined);
    assert.deepEqual(
        (await app.transcripts.allEntries(child, false)).map((entry) => entry.id),
        inherited,
        "the fork keeps both ancestors' history",
    );

    await archive(child);
    assert.equal((await call("/api/x/session-cleanup/remove", { ids: [child] })).status, 200);
    assert.equal(existsSync(grandFiles.uploads), false);
    assert.equal(existsSync(parentFiles.uploads), false);
    assert.deepEqual(storedRows(grand), noRows, "the grandparent's kept rows go");
    assert.deepEqual(storedRows(parent), noRows, "the parent's kept rows go");
});

test("removing the session a fork came from keeps the history the fork reads", async () => {
    const parent = await newSession(app);

    await say(app, parent, "hello");
    const child = (
        await app.commands.fork(parent, owner(app), {
            entryId: (await app.transcripts.allEntries(parent, false)).at(-1)!.id,
        })
    ).id;

    await say(app, child, "carry on");
    const before = (await app.transcripts.allEntries(child, false)).map((entry) => entry.id);

    await archive(parent);

    const [outcome] = (await call("/api/x/session-cleanup/remove", { ids: [parent] })).data
        .outcomes;

    assert.equal(outcome.done, true);
    const link = conversationRecord(child).parent as { conversationId?: number } | undefined;

    assert.equal(link?.conversationId, Number(parent), "the fork keeps its parent link");
    assert.deepEqual(
        (await app.transcripts.allEntries(child, false)).map((entry) => entry.id),
        before,
        "the fork reads the same history as before the removal",
    );
    assert.ok(storedRows(parent).conversations > 0, "the parent's row stays for the fork");

    // The last fork's removal takes the rows its history kept.
    await archive(child);
    const [last] = (await call("/api/x/session-cleanup/remove", { ids: [child] })).data.outcomes;

    assert.equal(last.done, true);
    assert.deepEqual(storedRows(parent), noRows, "the kept rows go with the last fork");
});

test("a fork made while the removal checks the session keeps the uploads it reads", async () => {
    const id = await newSession(app);

    await say(app, id, "hello");
    const files = filesOf(id);
    const entryId = (await app.transcripts.allEntries(id, false)).at(-1)!.id;
    const get = app.watches.get.bind(app.watches);
    let fork: ConversationId | undefined;

    await archive(id);

    // The plan's slow steps: a person forks the session in the meantime.
    app.watches.get = async (each) => {
        fork ??= (await app.commands.fork(id, owner(app), { entryId })).id;

        return get(each);
    };

    const done = await call("/api/x/session-cleanup/remove", { ids: [id] }).finally(() => {
        app.watches.get = get;
    });

    assert.equal(done.data.outcomes[0].done, true);
    assert.ok(fork !== undefined && app.sessionMeta(fork) !== undefined);
    assert.equal(existsSync(files.uploads), true, "the fork reads them");
});

test("a fork that a removal overtakes is refused, so it never reads uploads that go", async () => {
    const id = await newSession(app);

    await say(app, id, "hello");
    const files = filesOf(id);
    const entryId = (await app.transcripts.allEntries(id, false)).at(-1)!.id;
    const agentState = app.agentState.bind(app);

    await archive(id);

    // The fork has passed its checks; the removal commits before the fork does.
    app.agentState = async (each) => {
        app.agentState = agentState;
        assert.equal((await call("/api/x/session-cleanup/remove", { ids: [id] })).status, 200);

        return agentState(each);
    };

    await assert.rejects(app.commands.fork(id, owner(app), { entryId }), { status: 409 });
    assert.equal(existsSync(files.uploads), false);
});

test("a removal that a restart cut short goes on at the next start", async () => {
    const id = await newSession(app);
    const files = filesOf(id);

    await archive(id);
    assert.equal((await call(`/api/c/${id}/trust`)).status, 200);
    // The removal's commit, as a crash right after it left it: the files are still there.
    await app.harness.commit(async (tx) => {
        const sessions = await tx.doc(SessionsDoc);
        const meta = sessions.items[String(id)]!;

        delete sessions.items[String(id)];
        (await tx.doc(DeletedDoc)).items[String(id)] = {
            cwd: meta.cwd,
            conversations: [Number(id)],
            by: owner(app).id,
            at: Date.now(),
        };
    }, context);
    await stop();
    await start();

    await until(
        async () =>
            (await app.harness.snapshot(DeletedDoc, context))?.items[String(id)]?.done !==
            undefined,
        "the removal to finish",
    );
    assert.equal(existsSync(files.uploads), false);
    assert.equal(existsSync(files.logs), false);
    assert.equal((await call(`/api/c/${id}/trust`)).status, 404, "still out of the app");
    assert.deepEqual(storedRows(id), noRows, "the rows a restart cut the removal before go too");
});

test("an env file that git ignores keeps a worktree, also in an ignored folder", async () => {
    const id = await worktreeSession("Secrets");
    const env = join(app.sessionMeta(id)!.worktree!.path, "deps", "a", "prod.env");

    writeFileSync(join(repo, ".git", "info", "exclude"), "deps/\n");
    mkdirSync(join(env, ".."), { recursive: true });
    writeFileSync(env, "KEY=1\n");
    await archive(id);

    const [plan] = (await call("/api/x/session-cleanup/plan", { ids: [id] })).data.sessions;
    const [kept] = (await call("/api/x/session-cleanup/clean-up", { ids: [id] })).data.outcomes;
    const [stays] = (await call("/api/x/session-cleanup/remove", { ids: [id] })).data.outcomes;

    assert.equal(plan.worktree.state, "env");
    assert.match(kept.why, /env file that git ignores/);
    assert.equal(stays.done, false);
    assert.ok(existsSync(env));
});

test("the route the session list deletes with runs the same removal, with the module off", async () => {
    const id = await worktreeSession("Old list row");
    const files = filesOf(id);

    await say(app, id, "hello");
    await archive(id);
    // The sheet belongs to the module; the route and the removal are core's, so the session list keeps working.
    await app.setExtensionEnabled(owner(app), "session-cleanup.ts", false);

    try {
        const done = await call(`/api/sessions/${id}/delete`, {});

        assert.equal(done.status, 200, JSON.stringify(done.data));
        assert.equal(
            app.sessions().some((session) => session.id === Number(id)),
            false,
        );
        assert.equal(existsSync(files.uploads), false);
        assert.equal(existsSync(files.logs), false);
        assert.deepEqual(storedRows(id), noRows);

        const live = await newSession(app);
        const refused = await call(`/api/sessions/${live}/delete`, {});

        assert.equal(refused.status, 409);
        assert.match(String(refused.data.error), /Archive it first/);

        const guestDelete = await call(`/api/sessions/${live}/delete`, {}, guest);

        assert.equal(guestDelete.status, 403, "the owner's alone");
    } finally {
        await app.setExtensionEnabled(owner(app), "session-cleanup.ts", true);
    }
});

test("a session the removed one started stays, without a link to it", async () => {
    const id = await newSession(app);
    const child = await newSession(app);

    await say(app, id, "hello");
    await app.harness.commit(async (tx) => {
        (await tx.doc(SessionsDoc)).items[String(child)]!.linkedFrom = { id: Number(id) };
    }, context);
    await archive(id);

    assert.equal((await call(`/api/sessions/${id}/delete`, {})).status, 200);
    assert.equal(
        (await app.harness.snapshot(SessionsDoc, context))!.items[String(child)]?.linkedFrom,
        undefined,
        "the link to a session that is gone goes with it",
    );
    assert.ok(
        app.sessions().some((session) => session.id === Number(child)),
        "the session it started stays",
    );
});
