// Command Code's usage in the menu, and its sheet: credits, plan, and the 5-hour and weekly windows. The owner alone
// loads this module, so the numbers stay theirs.
export const pocketApi = 2;

const USAGE_URL = "https://commandcode.ai/usage";
const REFRESH_MS = 5 * 60_000;
const WINDOW_LABELS = { fiveHour: "5-hour", weekly: "Weekly" };

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

    function UsageSheet() {
        const [usage, setUsage] = useState(null);
        const [error, setError] = useState(null);
        const [busy, setBusy] = useState(false);

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
                html`<div class="usage-head">
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
                        <span
                            style=${`width: ${Math.min(100, Math.max(0, usage.percent))}%`}
                        ></span>
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
                        html`<p class="muted small">
                            Unavailable now: ${usage.unavailable.join(", ")}.
                        </p>`
                    }
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
        </div>`;
    }

    pocket.style("style.css");
    pocket.sheet({ id: "usage", title: "Command Code usage", component: UsageSheet });

    return () => clearInterval(timer);
}
