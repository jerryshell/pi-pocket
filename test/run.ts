/**
 * Runs the test suite by group: `all` (`npm test`), `core` (every file that is not an app-level browser test), or `ui`
 * (the `*-ui.test.ts` files and `browser.test.ts`, which load the app in Chromium). One list decides every group, so a
 * new test file joins one by its name.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const folder = dirname(fileURLToPath(import.meta.url));
const group = process.argv[2] ?? "all";

if (group !== "all" && group !== "core" && group !== "ui") {
    console.error(`Use all, core, or ui, not ${group}.`);
    process.exit(2);
}

const names = readdirSync(folder)
    .filter((name) => name.endsWith(".test.ts"))
    .sort();

/** The tests that load the whole web app in Chromium: `*-ui.test.ts`, and the built-in browser's own. */
const isUi = (name: string) => name.endsWith("-ui.test.ts") || name === "browser.test.ts";

const selected = group === "all" ? names : names.filter((name) => isUi(name) === (group === "ui"));

const run = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...selected.map((name) => join(folder, name))],
    { stdio: "inherit" },
);

process.exit(run.status ?? 1);
