/**
 * Removing a deleted session's rows from the SQLite file.
 *
 * Pi Durable keeps conversations, entries, tasks, submissions, documents, and their revisions append-only: it has no
 * delete call. Pi Pocket's owner can delete an archived session for good, so this module removes exactly those rows,
 * after the session is out of `SessionsDoc`. It is safe to run again: every statement deletes only what is there.
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

/**
 * Delete `roots` and every conversation they own (their subagents), with all entries, tasks, submissions, documents,
 * revisions, and record ids. Returns every conversation id removed, so the caller can remove their uploads too.
 */
export async function purgeConversations(
    storage: Storage,
    roots: readonly ConversationId[],
): Promise<ConversationId[]> {
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

        const conversationIds = [...conversations];
        const taskIds = [...tasks];
        const entryIds = await idsIn(tx, tables.entries, "conversation_id", conversationIds);
        const submissionIds = await idsIn(
            tx,
            tables.submissions,
            "conversation_id",
            conversationIds,
        );
        const documentIds = await tx.all<{ id: number }>(
            `SELECT id FROM ${tables.documents}
             WHERE scope_kind = 'conversation' AND owner_id IN (${placeholders(conversationIds)})
                ${taskIds.length === 0 ? "" : `OR (scope_kind = 'task' AND owner_id IN (${placeholders(taskIds)}))`}`,
            ...conversationIds,
            ...taskIds,
        );
        const docs = documentIds.map((row) => row.id);

        await remove(tx, tables.documentRevisions, "document_id", docs);
        await remove(tx, tables.documents, "id", docs);
        await remove(tx, tables.entries, "conversation_id", conversationIds);
        await remove(tx, tables.submissions, "conversation_id", conversationIds);
        await remove(tx, tables.tasks, "conversation_id", conversationIds);
        await remove(tx, tables.conversations, "id", conversationIds);
        await remove(tx, tables.recordIds, "id", [
            ...new Set([...conversationIds, ...taskIds, ...entryIds, ...submissionIds, ...docs]),
        ]);

        return conversationIds as ConversationId[];
    });
}
