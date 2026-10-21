// Deleting an archived session for good: its catalogue entry, transcript, documents, tasks, and uploads go.
import {
    type App,
    cleanUp,
    context,
    newSession,
    openApp,
    owner,
    root,
    say,
    scriptedModel,
} from "./helpers.ts";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, before, test } from "node:test";
import { PurgeDoc, SessionsDoc } from "../src/server/docs.ts";

let app: App;
const dataDir = join(root, "data");

before(async () => {
    app = await openApp(scriptedModel());
});

after(async () => {
    await app.close();
    cleanUp();
});

test("an archived session is deleted for good, with its rows and uploads", async () => {
    const id = await newSession(app);
    const uploads = join(dataDir, "uploads", String(id));

    await say(app, id, "hello");
    await app.commands.updateSession(id, owner(app), { archived: true });
    mkdirSync(uploads, { recursive: true });
    writeFileSync(join(uploads, "note.txt"), "gone with the session");

    await app.commands.deleteSession(id, owner(app));

    assert.equal(
        app.sessions().some((session) => session.id === Number(id)),
        false,
    );
    assert.equal(await app.harness.conversation(id, context), undefined);
    assert.deepEqual((await app.harness.snapshot(PurgeDoc, context))?.ids, []);
    assert.equal(existsSync(uploads), false);

    const db = new DatabaseSync(join(dataDir, "pocket.sqlite"), { readOnly: true });

    try {
        const count = (table: string, column: string) =>
            (
                db
                    .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
                    .get(Number(id)) as { n: number }
            ).n;

        assert.equal(count("conversations", "id"), 0);
        assert.equal(count("entries", "conversation_id"), 0);
        assert.equal(count("tasks", "conversation_id"), 0);
        assert.equal(count("submissions", "conversation_id"), 0);
        assert.equal(count("documents", "owner_id"), 0);
        assert.equal(count("record_ids", "id"), 0);
    } finally {
        db.close();
    }
});

test("only an archived session the owner chooses is deleted", async () => {
    const live = await newSession(app);
    const guest = app.config.addUser("Guest", "guest").user;

    await assert.rejects(app.commands.deleteSession(live, owner(app)), {
        status: 409,
        message: /Archive the session/,
    });
    await app.commands.updateSession(live, owner(app), { archived: true });
    await assert.rejects(app.commands.deleteSession(live, guest), {
        status: 403,
        message: /Only the owner/,
    });
    assert.equal(
        app.sessions().some((session) => session.id === Number(live)),
        true,
    );
});

test("a session with a worktree stays until the worktree goes", async () => {
    const id = await newSession(app);

    await app.commands.updateSession(id, owner(app), { archived: true });
    await app.harness.commit(async (tx) => {
        const sessions = await tx.doc(SessionsDoc);

        sessions.items[String(id)]!.worktree = {
            path: join(root, "worktree"),
            branch: "pocket/test",
            source: root,
        };
    }, context);

    await assert.rejects(app.commands.deleteSession(id, owner(app)), {
        status: 409,
        message: /worktree/,
    });
});

test("a deletion that did not finish is completed before the next start reads sessions", async () => {
    const pending = await openApp(scriptedModel(), join(root, "pending"));
    const id = await newSession(pending);

    await say(pending, id, "hello");
    await pending.commands.updateSession(id, owner(pending), { archived: true });
    await pending.harness.commit(async (tx) => {
        const sessions = await tx.doc(SessionsDoc);
        const purge = await tx.doc(PurgeDoc);

        delete sessions.items[String(id)];
        purge.ids.push(Number(id));
    }, context);
    await pending.close();

    const reopened = await openApp(scriptedModel(), join(root, "pending"));

    try {
        assert.equal(
            reopened.sessions().some((session) => session.id === Number(id)),
            false,
        );
        assert.equal(await reopened.harness.conversation(id, context), undefined);

        const db = new DatabaseSync(join(root, "pending", "pocket.sqlite"), { readOnly: true });

        try {
            const count = (table: string, column: string) =>
                (
                    db
                        .prepare(`SELECT count(*) AS n FROM ${table} WHERE ${column} = ?`)
                        .get(Number(id)) as { n: number }
                ).n;

            assert.equal(count("conversations", "id"), 0);
            assert.equal(count("entries", "conversation_id"), 0);
        } finally {
            db.close();
        }
    } finally {
        await reopened.close();
    }
});
