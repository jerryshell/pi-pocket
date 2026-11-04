// Loop's status line: while a loop is on in the session this tab shows, an item there says so, and its sheet shows the
// aim and ends the loop. It uses only `pocket`.
export const pocketApi = 1;

export default function setup(pocket) {
    const { html, useEffect, useState } = pocket;

    // An app from before 0.19.0 has no status line or sheet for modules.
    if (typeof pocket.status !== "function") {
        return;
    }

    /** The session this tab shows, its loop, the status item, and the sheets that draw it. */
    let session = null;
    let loop = null;
    let item = null;
    /** Counts the asks, so that a slow answer for a session this tab left is dropped. */
    let asked = 0;
    const listeners = new Set();

    const told = () => {
        for (const run of listeners) {
            run();
        }
    };

    /** The status line says that a loop is on, or nothing. */
    const draw = () => {
        if (loop === null) {
            item?.remove();
            item = null;

            return;
        }

        const title = `Pi keeps going on its own: ${loop.goal}. Tap for the loop.`;

        if (item === null) {
            item = pocket.status({
                id: "loop",
                text: "∞ loop",
                short: "∞",
                title,
                sheet: "loop",
            });
        } else {
            item.update({ title });
        }
    };

    /** Ask the server for the loop of `id`: a tab that opens gets it at once, then follows the events. */
    const load = async (id) => {
        const mine = ++asked;

        try {
            const state = await pocket.api(`loop?conversation=${id}`);

            if (mine !== asked || id !== session) {
                return;
            }

            loop = state.on;
            draw();
            told();
        } catch {
            // A session this tab may not see, or one that went: there is nothing to show.
        }
    };

    pocket.onConversation((id) => {
        session = id;
        loop = null;
        asked += 1;
        draw();
        told();

        if (id !== null) {
            void load(id);
        }
    });

    pocket.on("loop", ({ conversation, on }) => {
        if (conversation !== session) {
            return;
        }

        loop = on;
        draw();
        told();
    });

    /** The hour and minute on this device, for when the loop began. */
    const began = (at) =>
        new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

    /** The loop of this session: what it works toward, when it began, and how it ends. */
    function LoopSheet({ close }) {
        const [, setDrawn] = useState(0);
        const [stopping, setStopping] = useState(false);
        const [problem, setProblem] = useState("");

        useEffect(() => {
            const run = () => setDrawn((drawn) => drawn + 1);

            listeners.add(run);

            return () => listeners.delete(run);
        }, []);

        const stop = async () => {
            setStopping(true);
            setProblem("");

            try {
                await pocket.api("loop/stop", { conversation: session, off: true });
                loop = null;
                draw();
                told();
                close();
            } catch (failure) {
                setProblem(failure?.message ?? "The loop could not be stopped.");
            } finally {
                setStopping(false);
            }
        };

        if (loop === null) {
            return html`<p class="muted small">No loop is on in this session.</p>`;
        }

        return html`<div class="loop-sheet">
            <p>
                <strong>Pi keeps going.</strong> After each of its answers it takes the next step
                toward the aim, checks its own work, and goes on, until someone stops it.
            </p>
            <p class="loop-sheet-goal">${loop.goal}</p>
            <p class="muted small">
                It began at ${began(loop.at)}, and every round is a message and model calls.
            </p>
            ${problem === "" ? null : html`<p class="loop-sheet-problem">${problem}</p>`}
            ${
                pocket.me()?.role === "viewer"
                    ? null
                    : html`<button class="button" disabled=${stopping} onClick=${stop}>
                          ${stopping ? "Stopping…" : "Stop the loop"}
                      </button>`
            }
            <p class="muted small">
                Stop, by the message box, ends Pi's run now. <code>/loop-off</code> ends the loop
                after its next answer.
            </p>
        </div>`;
    }

    pocket.style("style.css");
    pocket.sheet({ id: "loop", title: "Loop", component: LoopSheet });
}
