// Command Code's usage in the menu, and its sheet: credits, plan, and the 5-hour and weekly windows, for this account
// or for a key typed into the sheet. The owner alone loads this module, so the numbers stay theirs.
export const pocketApi = 2;

const USAGE_URL = "https://commandcode.ai/usage";
const REFRESH_MS = 5 * 60_000;
const MAX_KEY_LENGTH = 512;
const WINDOW_LABELS = { fiveHour: "5-hour", weekly: "Weekly" };
/** Where the account's requests go: the Provider API its plan entitles, or Command Code's Go fallback. */
const TRANSPORT_LABELS = {
    provider: "Provider API",
    generate: "Go fallback (/alpha/generate)",
    unknown: "not tried yet",
};

/** `$12.40`; an absent number reads as zero. */
function money(value) {
    return `$${(typeof value === "number" ? value : 0).toFixed(2)}`;
}

/** `in 4h 54m`, `in 1 day`, or `soon`: a window resets at this second of the epoch. */
function resetIn(resetAt, now = Date.now()) {
    const left = resetAt * 1000 - now;

    if (!Number.isFinite(left) || left <= 0) {
        return "soon";
    }

    const minutes = Math.ceil(left / 60_000);

    if (minutes < 60) {
        return `in ${minutes}m`;
    }

    const hours = Math.floor(minutes / 60);
    const rest = minutes % 60;

    if (hours < 24) {
        return rest > 0 ? `in ${hours}h ${rest}m` : `in ${hours}h`;
    }

    const days = Math.floor(hours / 24);

    return days === 1 ? "in 1 day" : `in ${days} days`;
}

/** `renewed on 10 Nov`; a period end is an ISO date. */
function periodEnd(iso) {
    const date = new Date(String(iso));

    return Number.isNaN(date.getTime())
        ? ""
        : ` · renews ${date.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`;
}

/** `just now`, `4m ago`: when the numbers were read. */
function readAt(at, now = Date.now()) {
    const minutes = Math.floor((now - at) / 60_000);

    return minutes < 1 ? "just now" : `${minutes}m ago`;
}

export default function setup(pocket) {
    const { html, useEffect, useState } = pocket;

    // What the menu's hint says, once an answer came.
    const row = pocket.menu({
        id: "usage",
        label: "Command Code usage",
        hint: "Read credits and limits",
        sheet: "usage",
    });

    const showHint = (usage) => {
        const five = usage.windows.find((window) => window.id === "fiveHour");
        const parts = [`${money(usage.remaining)} left`];

        if (five) {
            parts.push(`5h ${five.percent}%`);
        }

        row.update({ hint: parts.join(" · ") });
    };

    const read = (fresh) =>
        fresh ? pocket.api("usage", { fresh: true }) : pocket.api("usage", undefined);

    // The hint on load, then now and then: the sheet's Refresh reads again at once.
    const timer = setInterval(() => read().then(showHint, () => {}), REFRESH_MS);

    read().then(showHint, () => {});

    /** The credits line, its bar, and a bar for each window: the same for this account and for a typed key. */
    function Numbers({ usage }) {
        return html`<div class="usage-head">
                <div class="usage-remaining">
                    ${money(usage.remaining)}
                    <span class="muted"> left of ${money(usage.pool)}</span>
                </div>
                <div class="muted small">
                    ${usage.percent}%
                    used${usage.plan ? ` · plan ${usage.plan}` : ""}${periodEnd(usage.periodEnd)}
                </div>
            </div>
            <div class="usage-bar" role="img" aria-label=${`${usage.percent}% used`}>
                <span style=${`width: ${Math.min(100, Math.max(0, usage.percent))}%`}></span>
            </div>
            <div class="usage-windows">
                ${usage.windows.map(
                    (window) =>
                        html`<div class="usage-window" key=${window.id}>
                            <div class="usage-window-head">
                                <span>${WINDOW_LABELS[window.id] ?? window.id}</span>
                                <span class="muted">
                                    ${window.used.toFixed(2)} / ${window.cap.toFixed(2)}
                                </span>
                            </div>
                            <div class="usage-bar small">
                                <span
                                    style=${`width: ${Math.min(100, Math.max(0, window.percent))}%`}
                                ></span>
                            </div>
                            <div class="muted small">
                                ${window.percent}%
                                used${window.resetAt ? ` · resets ${resetIn(window.resetAt)}` : ""}
                            </div>
                        </div>`,
                )}
            </div>
            ${
                usage.unavailable.length > 0 &&
                html`<p class="muted small">Unavailable now: ${usage.unavailable.join(", ")}.</p>`
            }`;
    }

    function UsageSheet() {
        const [usage, setUsage] = useState(null);
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(false);
        const [typed, setTyped] = useState("");
        const [other, setOther] = useState(null);
        const [otherError, setOtherError] = useState(null);
        const [checking, setChecking] = useState(false);

        useEffect(() => {
            let live = true;

            read().then(
                (next) => {
                    if (live) {
                        setUsage(next);
                        showHint(next);
                    }
                },
                (failure) => live && setError(failure?.message ?? String(failure)),
            );

            return () => {
                live = false;
            };
        }, []);

        const again = () => {
            setBusy(true);
            setError(null);

            read(true)
                .then(
                    (next) => {
                        setUsage(next);
                        showHint(next);
                    },
                    (failure) => setError(failure?.message ?? String(failure)),
                )
                .finally(() => setBusy(false));
        };

        // The key goes to the module's route for this read alone: it stays in this box, and comes back as no part of the
        // answer, so the sheet forgets it as soon as it was sent.
        const check = (event) => {
            event.preventDefault();

            const key = typed.trim();

            if (key === "" || checking) {
                return;
            }

            setChecking(true);
            setOther(null);
            setOtherError(null);

            pocket
                .api("usage", { apiKey: key })
                .then(
                    (next) => {
                        setOther(next);
                        setTyped("");
                    },
                    (failure) => setOtherError(failure?.message ?? String(failure)),
                )
                .finally(() => setChecking(false));
        };

        return html`<div class="code-usage">
            ${
                error &&
                html`<div class="error-box">
                    <p>${error}</p>
                    <button class="button" onClick=${again}>Try again</button>
                </div>`
            }
            ${!usage && !error && html`<${pocket.Loader} label="Reading Command Code usage" />`}
            ${
                usage &&
                html`<${Numbers} usage=${usage} />
                    <p class="muted small">
                        Requests: ${TRANSPORT_LABELS[usage.transport] ?? TRANSPORT_LABELS.unknown}
                    </p>
                    <div class="usage-foot">
                        <span class="muted small">${readAt(usage.at)}</span>
                        <button class="button small" disabled=${busy} onClick=${again}>
                            ${busy ? "Refreshing…" : "Refresh"}
                        </button>
                    </div>
                    <p class="muted small">
                        <a href=${USAGE_URL} target="_blank" rel="noopener"
                            >Full detail on Command Code</a
                        >
                    </p>`
            }
            <form class="usage-key" onSubmit=${check}>
                <div class="field">
                    <label class="label" for="commandcode-usage-key">Check another key</label>
                    <div class="usage-key-row">
                        <input
                            id="commandcode-usage-key"
                            type="password"
                            autocomplete="off"
                            spellcheck="false"
                            maxlength=${MAX_KEY_LENGTH}
                            placeholder="Paste an API key"
                            value=${typed}
                            onInput=${(event) => setTyped(event.currentTarget.value)}
                        />
                        <button
                            class="button small"
                            type="submit"
                            disabled=${checking || typed.trim() === ""}
                        >
                            ${checking ? "Checking…" : "Check"}
                        </button>
                    </div>
                </div>
                <p class="muted small">
                    Read once for that key. It is not saved, and it is not used for this account.
                </p>
            </form>
            ${
                otherError &&
                html`<div class="error-box">
                    <p>${otherError}</p>
                </div>`
            }
            ${
                other &&
                html`<div class="usage-other">
                    <div class="usage-other-head">
                        <span>Another key</span>
                        <button class="button small" onClick=${() => setOther(null)}>Clear</button>
                    </div>
                    ${
                        other.keyName &&
                        html`<p class="muted small">Command Code names it “${other.keyName}”.</p>`
                    }
                    <${Numbers} usage=${other} />
                </div>`
            }
        </div>`;
    }

    pocket.style("style.css");
    pocket.sheet({ id: "usage", title: "Command Code usage", component: UsageSheet });

    return () => clearInterval(timer);
}
