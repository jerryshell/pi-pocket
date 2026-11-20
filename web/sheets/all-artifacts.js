// Every artifact in every session, one row each, with the number of its current (latest) version.
import { folderColor } from "../avatar.js";
import { useEffect, useState } from "preact/hooks";
import { api, attempt, closeSheet, navigate, notify, store } from "../store.js";
import { formatBytes, html, Icon, Loader, Sheet, timeAgo } from "../ui.js";

/** The entries (newest first) in groups by session, in the order the sessions first appear. */
function bySession(entries) {
    const groups = new Map();

    for (const entry of entries) {
        const group = groups.get(entry.session) ?? {
            session: entry.session,
            title: entry.sessionTitle,
            entries: [],
        };

        group.entries.push(entry);
        groups.set(entry.session, group);
    }

    return [...groups.values()];
}

/** One session's artifacts, in a frame of its own: a header with the session, then a row for each. */
function Group({ group, open, remove, canDelete, deleting }) {
    const cwd = store.state.sessions.find((entry) => entry.id === group.session)?.cwd;
    const title = group.title || `Session ${group.session}`;

    return html`<div class="overview-group">
        <div class="overview-head">
            <span
                class="folder-mark"
                style=${`--folder:${folderColor(cwd)}`}
                aria-hidden="true"
            ></span>
            <span class="grow overview-session">${title}</span>
            <span class="muted small">${group.entries.length}</span>
        </div>
        ${group.entries.map((entry) => {
            const about = `${entry.kind ?? entry.type} · ${formatBytes(entry.size)} · ${timeAgo(entry.updatedAt)}`;
            const removing = deleting === `${entry.session}/${entry.id}`;

            return html`<div class="overview-row" key=${entry.id}>
                <button class="overview-open" onClick=${() => open(entry)}>
                    <${Icon} name="artifact" size=${16} />
                    <span class="overview-main">
                        <span class="overview-title">${entry.title}</span>
                        <span class="muted small mono">${about}</span>
                    </span>
                    <span
                        class="overview-version"
                        title=${`Current version: ${entry.current}, of ${entry.versions}`}
                    >
                        v${entry.current}
                        ${entry.versions > 1 && html`<span class="muted"> / ${entry.versions}</span>`}
                    </span>
                </button>
                ${
                    canDelete &&
                    html`<button
                        class="icon-button small overview-delete"
                        title=${`Delete ${entry.title}`}
                        aria-label=${`Delete ${entry.title}`}
                        disabled=${removing}
                        onClick=${() => remove(entry)}
                    >
                        <${Icon} name="trash" size=${16} />
                    </button>`
                }
            </div>`;
        })}
    </div>`;
}

/** All artifacts, across sessions: a tap opens the current version in its session. */
export function AllArtifactsSheet() {
    const { me } = store.state;
    const [entries, setEntries] = useState(null);
    const [failed, setFailed] = useState(null);
    const [deleting, setDeleting] = useState(null);
    const canDelete = me?.role !== undefined && me.role !== "viewer";

    useEffect(() => {
        let open = true;

        api("artifacts").then(
            (list) => open && setEntries(list),
            (error) => {
                if (open) {
                    setFailed(error.message);
                    notify("error", error.message);
                }
            },
        );

        return () => {
            open = false;
        };
    }, []);

    const open = (entry) => {
        closeSheet();
        navigate(entry.session, {
            sheet: { type: "viewer", id: entry.id, version: entry.current },
        });
    };

    const remove = (entry) => {
        const what = entry.versions === 1 ? "Its only version" : `All ${entry.versions} versions`;

        if (
            !confirm(
                `Delete “${entry.title}”? ${what}, the state saved for its pages, and its share links go too. This cannot be undone.`,
            )
        ) {
            return;
        }

        const key = `${entry.session}/${entry.id}`;

        setDeleting(key);
        attempt(async () => {
            await api(`c/${entry.session}/artifacts/${encodeURIComponent(entry.id)}`, undefined, {
                method: "DELETE",
            });
            setEntries((list) =>
                (list ?? []).filter(
                    (each) => each.session !== entry.session || each.id !== entry.id,
                ),
            );
            notify("info", `Deleted “${entry.title}”.`);
        }).finally(() => setDeleting(null));
    };

    return html`<${Sheet} title="All artifacts" onClose=${closeSheet} wide=${true}>
        ${entries === null && failed === null && html`<${Loader} label="Looking" />`}
        ${failed !== null && html`<p class="warn">${failed}</p>`}
        ${
            entries?.length === 0 &&
            html`<p class="muted">
                No artifacts yet. Ask Pi to build something you can look at: a chart, a demo, a game.
            </p>`
        }
        ${bySession(entries ?? []).map(
            (group) => html`<${Group}
                key=${group.session}
                group=${group}
                open=${open}
                remove=${remove}
                canDelete=${canDelete}
                deleting=${deleting}
            />`,
        )}
    <//>`;
}
