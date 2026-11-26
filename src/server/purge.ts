/**
 * Removing a deleted session's rows from the SQLite file.
 *
 * Pi Durable keeps conversations, entries, tasks, submissions, documents, and their revisions append-only: it has no
 * delete call. Pi Pocket's owner can delete an archived session for good, so this module removes exactly those rows,
 * after the session is out of `SessionsDoc` (`PocketApp.purgeStoredData`, called by `session-cleanup.ts` once the
 * session's files are gone). It is safe to run again: every statement deletes only what is there.
 *
 * A fork reads the history before its fork point through its parent conversation's entries. When the parent session is
 * removed first, the rows of the entries the fork still reads stay, with its conversation row, like the uploads a fork
 * reads. The removal record keeps them (`keepHistory`), and they go when the last fork that reads them is removed.
 */
import type { ConversationId, Storage } from "@earendil-works/pi-durable";

type SqlValue = string | number | bigint | null | Uint8Array;

type SqlExecutor = {
    all<T extends object>(sql: string, ...params: SqlValue[]): Promise<T[]>;
    run(sql: string, ...params: SqlValue[]): Promise<void>;
};

type SqliteTables = {
    durableSchema: string;
    durableMetadata: string;
    recordIds: string;
    conversations: string;
    entries: string;
    tasks: string;
    submissions: string;
    documents: string;
    documentRevisions: string;
};

type SqliteStorage = {
    schema: { tables: SqliteTables };
    db: SqlExecutor & {
        transaction<T>(run: (tx: SqlExecutor) => Promise<T>): Promise<T>;
    };
};

export type PurgeResult = {
    /** Every conversation of the removed sessions, for spend and what the app forgets. A kept one's row stays. */
    removed: ConversationId[];
    /** Conversations whose rows stay for a surviving fork's history: its conversation and the entries it reads. */
    kept: ConversationId[];
};

const placeholders = (values: readonly unknown[]): string => values.map(() => "?").join(", ");

async function idsIn(tx: SqlExecutor, table: string, column: string, ids: readonly number[]) {
    if (ids.length === 0) {
        return [];
    }

    const rows = await tx.all<{ id: number }>(
        `SELECT id FROM ${table} WHERE ${column} IN (${placeholders(ids)})`,
        ...ids,
    );

    return rows.map((row) => row.id);
}

async function remove(tx: SqlExecutor, table: string, column: string, ids: readonly number[]) {
    if (ids.length === 0) {
        return;
    }

    await tx.run(`DELETE FROM ${table} WHERE ${column} IN (${placeholders(ids)})`, ...ids);
}

/** A conversation's parent link: the conversation it was forked from, and the entry there it was forked at. */
function parentOf(record: string): { conversationId: number; at: number } | undefined {
    try {
        const parent = (
            JSON.parse(record) as {
                parent?: { conversationId?: unknown; at?: unknown };
            }
        ).parent;
        const conversationId = Number(parent?.conversationId);
        const at = Number(parent?.at);

        return parent !== undefined && Number.isFinite(conversationId) && Number.isFinite(at)
            ? { conversationId, at }
            : undefined;
    } catch {
        return undefined;
    }
}

/**
 * Delete `roots` and every conversation they own (their subagents), with their entries, tasks, submissions, documents,
 * revisions, and record ids. A conversation that a surviving fork reads keeps its row and the entries up to that fork
 * point: those are the fork's history, not the removed session's. `kept` names them, so the caller can remove them when
 * the last fork that reads them goes.
 */
export async function purgeConversations(
    storage: Storage,
    roots: readonly ConversationId[],
): Promise<PurgeResult> {
    const sqlite = storage as unknown as Partial<SqliteStorage>;
    const tables = sqlite.schema?.tables;
    const db = sqlite.db;

    if (db === undefined || tables === undefined) {
        throw new Error("Deleting a session needs Pi Pocket's SQLite storage.");
    }

    return db.transaction(async (tx) => {
        const conversations = new Set<number>(roots.map(Number));
        const tasks = new Set<number>();

        // A subagent conversation belongs to the task that started it, so follow both owner edges to a fixed point.
        for (;;) {
            const ownTasks = await idsIn(tx, tables.tasks, "conversation_id", [...conversations]);
            const byConversation = await idsIn(tx, tables.conversations, "owner_conversation_id", [
                ...conversations,
            ]);
            const byTask =
                tasks.size === 0
                    ? []
                    : await idsIn(tx, tables.conversations, "owner_task_id", [...tasks]);
            let changed = false;

            for (const id of ownTasks) {
                if (!tasks.has(id)) {
                    tasks.add(id);
                    changed = true;
                }
            }

            for (const id of [...byConversation, ...byTask]) {
                if (!conversations.has(id)) {
                    conversations.add(id);
                    changed = true;
                }
            }

            if (!changed) {
                break;
            }
        }

        const rows = await tx.all<{ id: number; record: string }>(
            `SELECT id, record FROM ${tables.conversations}`,
        );
        const records = new Map(rows.map((row) => [row.id, row.record] as const));
        const kept = new Set<number>();
        const keepThrough = new Map<number, number>();

        // A fork that stays reads its ancestors' entries, up to each fork point. Those are the rows it keeps.
        for (const [id, record] of records) {
            if (conversations.has(id)) {
                continue;
            }

            let current = record;
            let upper = Number.POSITIVE_INFINITY;

            for (let depth = 0; depth < 64; depth++) {
                const parent = parentOf(current);

                if (parent === undefined) {
                    break;
                }

                upper = Math.min(upper, parent.at);

                const parentRecord = records.get(parent.conversationId);

                if (parentRecord === undefined) {
                    break;
                }

                if (conversations.has(parent.conversationId)) {
                    kept.add(parent.conversationId);
                    keepThrough.set(
                        parent.conversationId,
                        Math.max(keepThrough.get(parent.conversationId) ?? 0, upper),
                    );
                }

                current = parentRecord;
            }
        }

        const allIds = [...conversations];
        const keptIds = [...kept];
        const goneIds = allIds.filter((id) => !kept.has(id));
        const taskIds = [...tasks];

        // The entries a kept conversation reads stay; the rest go with it.
        const keptEntries = new Set<number>();

        for (const id of keptIds) {
            const through = keepThrough.get(id) ?? 0;
            const rows = await tx.all<{ id: number }>(
                `SELECT id FROM ${tables.entries} WHERE conversation_id = ? AND id <= ?`,
                id,
                through,
            );

            for (const row of rows) {
                keptEntries.add(row.id);
            }
        }

        const entryIds = await idsIn(tx, tables.entries, "conversation_id", allIds);
        const goneEntryIds = entryIds.filter((id) => !keptEntries.has(id));
        const submissionIds = await idsIn(tx, tables.submissions, "conversation_id", allIds);
        const documentIds = await tx.all<{ id: number }>(
            `SELECT id FROM ${tables.documents}
             WHERE scope_kind = 'conversation' AND owner_id IN (${placeholders(allIds)})
                ${taskIds.length === 0 ? "" : `OR (scope_kind = 'task' AND owner_id IN (${placeholders(taskIds)}))`}`,
            ...allIds,
            ...taskIds,
        );
        const docs = documentIds.map((row) => row.id);

        await remove(tx, tables.documentRevisions, "document_id", docs);
        await remove(tx, tables.documents, "id", docs);
        await remove(tx, tables.entries, "conversation_id", goneIds);

        for (const id of keptIds) {
            await tx.run(
                `DELETE FROM ${tables.entries} WHERE conversation_id = ? AND id > ?`,
                id,
                keepThrough.get(id) ?? 0,
            );
        }

        await remove(tx, tables.submissions, "conversation_id", allIds);
        await remove(tx, tables.tasks, "conversation_id", allIds);
        await remove(tx, tables.conversations, "id", goneIds);
        await remove(tx, tables.recordIds, "id", [
            ...new Set([...goneIds, ...goneEntryIds, ...taskIds, ...submissionIds, ...docs]),
        ]);

        return {
            removed: allIds as ConversationId[],
            kept: keptIds as ConversationId[],
        };
    });
}
