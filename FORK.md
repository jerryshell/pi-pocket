# Pi Pocket, this fork

Pi Pocket, maintained separately as a fork of [TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket).
It follows that project's releases by merging its release tags into `main`. This fork makes changes upstream
does not have and keeps them through each sync.

This page is the single list of the fork's differences from upstream. It says what each addition does, where
its code and tests are, and what a merge must keep. [README.md](README.md) is the short list;
[docs/features.md](docs/features.md) is the app's feature tour; [docs/map.md](docs/map.md) says which file
owns what; [docs/architecture.md](docs/architecture.md) says what depends on what;
[AGENTS.md](AGENTS.md) and [docs/self-editing.md](docs/self-editing.md) say how to edit and check;
[src/server/commandcode/README.md](src/server/commandcode/README.md) says what the vendored provider copies
and what its own sync keeps.

## Where each thing lives

| Question                                                         | Answer                                                               |
| ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| What does the fork add, in one line each?                        | [README.md](README.md)                                               |
| What does each addition do, where is it, what must a merge keep? | This page                                                            |
| What does the app let people do?                                 | [docs/features.md](docs/features.md)                                 |
| What does each file own?                                         | [docs/map.md](docs/map.md)                                           |
| What depends on what?                                            | [docs/architecture.md](docs/architecture.md)                         |
| How is this checkout edited and tested?                          | [AGENTS.md](AGENTS.md), [docs/self-editing.md](docs/self-editing.md) |
| What does the vendored Command Code provider copy?               | [src/server/commandcode/README.md](src/server/commandcode/README.md) |

## The additions

### Command Code models

[Command Code](https://commandcode.ai) works as a provider without an extra package or a hand-written
`models.json`.

- Sign in from Menu → Providers with an API key, or with the browser flow when the browser runs on the
  server's machine.
- Models come from Command Code's own catalog, kept at `~/.pi/agent/commandcode-models.json` and refreshed
  with **Refresh models**.
- Each model uses the wire Command Code serves it on (Chat Completions, Responses, or Anthropic Messages),
  with its thinking levels, image input, context limits, and display prices.
- Zero data retention is on by default. Every Provider API request asks for it, and `/commandcode-zdr off`
  (kept in Pi's `settings.json`) or `CMD_ZDR=0` turns it off. The Go plan's `/alpha/generate` fallback never
  sends it.
- `/commandcode-quota` is the owner's card for the account's credits, plan, usage, and 5-hour and weekly
  windows. Menu → **Command Code usage** shows the same numbers in a sheet, and reads any API key typed there
  for one answer. Pi Pocket does not save, cache, or return that key.
- Pi Pocket retries a 503 that says Command Code could not verify the credit balance without end, until Stop
  or Interrupt, instead of failing the run as a billing error. The wait survives a restart. A real credit or
  billing error still fails at once.

Upstream has no Command Code provider. This one is vendored from
[`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider) (MIT), and the Go plan
needs the `/alpha/generate` client upstream removed. [Its README](src/server/commandcode/README.md) says what
is copied, what is adapted, how the fallback works, and what a sync of that code must keep.

The code is in `src/server/commandcode/`, `src/server/extensions/commandcode.ts`, and
`src/server/extensions/commandcode/`, with `commandcode` entries in `limit-gate.ts`'s `RECORDS_FETCH` and
`reload.ts`'s `ORDER`. Tests are in `test/commandcode*.test.ts`, and the credit-check wait in
`test/limits.test.ts` and `test/limit-gate.test.ts`. Turn it off in Menu → Extensions like any module.

### Loop

`/loop-on make the tests pass` keeps Pi working on its own, answer after answer, until someone stops it.

- After each answer Pi takes the next step toward the aim, checks its own work, says in one line what it
  did, and goes on. It does not ask for permission, and does not ask whether to go on.
- Each round arrives as a message that starts with `[loop]`, for the person who started the loop, whose
  work it is.
- `/loop-off` ends it after Pi's answer, and Stop ends it at once. A run that ends without going on ends it
  too, with a notice. In plan mode it waits until the plan is answered.
- The status line says **∞ loop**, and its sheet shows the aim and **Stop the loop**.
- The loop is a `pocket.loop` document and a durable task, so a restart goes on with it.
- Nothing stops a loop except people, and the session's spend limit if the owner set one. Turn it off in
  Extensions.

The code is in `src/server/extensions/loop.ts` and `src/server/extensions/loop/`, with `loop.ts` in
`reload.ts`'s `ORDER`. Tests are in `test/loop.test.ts` and `test/loop-ui.test.ts`. Upstream has no
counterpart.

### A removal that clears the database

Upstream takes a removed session out of the app with its files and leaves the transcript in the database,
until Pi Durable grows a way to purge a conversation. This fork purges it. Once a session's worktree, files,
uploads, and logs are gone, its conversations' entries, tasks, submissions, documents, revisions, and
per-session spend record go too. Pi Durable has no delete of a conversation, so `purge.ts` deletes those rows
from Pi Durable's tables directly.

A fork reads the history before its fork point through its parent conversation's entries. When the parent
session goes first, the conversation row and the entries the fork reads stay, like the uploads a fork reads:
the fork keeps working with its history. `pocket.deleted` keeps them (`keepHistory`), and they go when the last
fork that reads them is removed. The confirm says this too.

The removal itself is upstream's Session cleanup. Before anything goes, the plan reports the worktree's
state, any env file git ignores, the uploads a live fork reads, links, schedules, and lessons. Its
`pocket.deleted` document is the queue, and `resume` finishes at start whatever a restart cut short. The fork
adds:

- the purge after the files, the rows a live fork reads kept until the last fork goes, and the `linkedFrom`
  cleanup in the removal's commit;
- its own entry points, which run that same removal through the core route
  `POST /api/sessions/:id/delete`: the trash button on an archived row, **Delete permanently** in its hold
  menu, and **Delete** in the selection bar. They work with the Session cleanup module off;
- the confirm's copy, which says a removal takes the transcript, tasks, and documents out of the database,
  except the history a live fork keeps.

The code is in `src/server/purge.ts`, `PocketApp.purgeStoredData`, the call in `session-cleanup.ts`'s
`#finish`, `SpendDoc.forget`, the guard at the top of `commands.ts`'s `#fork`, the route in `http/api.ts`,
`web/sessions.js`, `web/sheets/session.js`, and `extensions/session-cleanup/index.js` (the confirm's copy). Tests are in `test/session-cleanup.test.ts` and
`test/sessions.test.ts`. `pocket.purge` stays defined in `docs.ts` because stored kinds are not removed, and
nothing reads or writes it.

### Changes across a folder of repositories, and History

A session's folder can hold several checkouts of their own, and Changes reviews each of them. History shows
what is already committed.

- The folder gets a row of chips, one per repository right under it, with its branch, how far that is from
  the remote branch it follows, and how many files changed in it. The review shows the one picked, and this
  browser remembers it for the session.
- The rest works as it does for one repository: the file tree, the filter, **π only**, viewed marks, side by
  side or unified diffs, and ↺ to put a file back.
- The list covers one folder deep, without hidden folders or `node_modules`, at most 20 of them, kept for
  three seconds.
- A folder that is itself in a repository reads as before, and so does one with no repository under it.
- History lists the checked-out branch's commits, newest first, with short hash, subject, author, and when,
  up to 50. A commit opens its own diff under its row, file by file: each file folds from its header, and
  **Fold all** folds every one of them (or opens them all again). The repository chips stay, and a clean
  repository has nothing to review but its history.

The code is in `src/server/changes.ts` (`reposUnder`, `repoState`, `commitsIn`, `commitDiffIn`),
`src/server/branches.ts` (the `/commits` route), `src/server/workspace.ts`, `web/app.js`, `web/diff.js`,
`web/store.js`, `web/style.css`, and `web/sheets/branch.js`. Tests are in `test/changes.test.ts` and
`test/history.test.ts`. Upstream has no counterpart.

### Artifact deletion

Upstream deletes an artifact with all its versions and leaves only the replies' deleted cards. This fork also
deletes one version, writes in the chat who removed it, and adds a delete button to All artifacts.

- `DELETE /api/c/:id/artifacts/:artifact` still removes the artifact and every version.
- `DELETE /api/c/:id/artifacts/:artifact/:version` removes one version's body, the design comments made on
  that version, and share links pinned to it. The other versions, their assets, the artifact's saved state,
  and links that follow the newest version stay. Deleting the last version also deletes the artifact.
- The bin on a version's card in the Artifacts sheet deletes that version. The viewer's bin deletes the
  version it shows, and **delete all** removes the artifact. All artifacts has a trash button for the whole
  artifact.
- The activity line names the version removed, or the artifact when someone removes its last version. A card
  that names a deleted version says it was deleted, and the viewer says so and offers the latest version. Pi
  Pocket records the version number in `ended` so a new version never reuses it.

The code is in `src/server/artifacts.ts`, `src/server/http/conversation-routes.ts`,
`src/server/docs.ts` (`ended`), `web/sheets/viewers.js`, `web/sheets/all-artifacts.js`, `web/rich.js`, and
`web/style.css`. Tests are in `test/artifact-delete.test.ts`, `test/artifact-overview.test.ts`, and
`test/shares.test.ts`. Upstream has the whole-artifact delete. The fork adds the version delete, the activity
line, and the All artifacts delete.

### Cache miss notices

Pi's terminal app has its own notices for a prompt cache miss (`showCacheMissNotices`). Pi's package does not
export `core/cache-stats.ts`. The fork ports the count to Pi Durable's entries. A request whose prompt the
provider no longer held cached pays for those tokens again. The answer that paid says so under its last words,
with the tokens and roughly what they cost. It names a model switch, or 5 minutes or more of idle, as the likely cause. It leaves out the first
request, the context after a compaction or a fresh start, and a provider that never reports cache use. It
shows a miss of at least 20,000 tokens or $0.10. A tool call's cache miss shows with the answer that ends its
run. The status line's cache item adds the session's total. Appearance → Conversation turns the line off.

The code is in `src/server/cache-misses.ts`, with `entry-presentation.ts`'s option, `room.ts`'s scan,
`projection.ts`'s `cacheMiss` and `cacheWaste`, `web/turns.js`'s run total, `web/transcript.js`'s line, and
`web/theme.js`'s switch. Tests are in `test/cache-misses.test.ts`, `test/cache-waste.test.ts`, and
`test/cache-waste-ui.test.ts`. Upstream has no counterpart.

### A browser page that closes after use

Pi's `browser` tool left its page open for half an hour after the last use, and the Chromium behind it for
five minutes more. In this fork:

- The end of Pi's run closes the page it opened, unless a tab watches it or a person used it in the panel. A
  page may hold a sign-in or a half-filled form, and those are theirs to come back to.
- The tool takes `close`, for a page it is done with before the run ends.
- The browser stops a minute after its last page closed, not five, and the next page starts it again.

The code is in `src/server/browser.ts`, `src/server/browser/page.ts`,
`src/server/extensions/browser.ts`, `src/server/http/browser-routes.ts`, and `src/server/host.ts`
(`browsers` gains `page` and `close`). Tests are in `test/browser.test.ts`. Upstream has no counterpart.

## Shared files a merge must keep

New files are the fork's own and need no resolution. These are upstream's files changed here. Take the
fork's side, then make the new upstream behavior fit it. For `package.json`, resolve the dependencies first and
run `npm install` for `package-lock.json` rather than taking either lock whole. Merge the docs by hand. Keep
the fork's text and the new upstream facts around it. [docs/map.md](docs/map.md) lists every file.

| Area                 | Shared files, and the change to keep                                                                                                                                                               |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Command Code         | `reload.ts` (`ORDER`), `limit-gate.ts` (`RECORDS_FETCH`, the unlimited wait), `limits.ts` (the credit check)                                                                                       |
| Loop                 | `reload.ts` (`ORDER`)                                                                                                                                                                              |
| Removal              | `app.ts`, `commands.ts`, `session-cleanup.ts`, `docs.ts` (`PurgeDoc`, `keepHistory`), `spend.ts`, `http/api.ts`, `extensions/session-cleanup/index.js`, `web/sessions.js`, `web/sheets/session.js` |
| Changes and History  | `changes.ts`, `workspace.ts`, `branches.ts`, `http/conversation-routes.ts`, `web/app.js`, `web/diff.js`, `web/store.js`, `web/style.css`, `web/sheets/branch.js`                                   |
| Browser              | `browser.ts`, `browser/page.ts`, `extensions/browser.ts`, `http/browser-routes.ts`, `host.ts`                                                                                                      |
| Artifacts            | `artifacts.ts`, `http/conversation-routes.ts`, `web/sheets/viewers.js`, `web/sheets/all-artifacts.js`, `web/rich.js`, `web/style.css`                                                              |
| Cache miss notices   | `projection.ts`, `room.ts`, `entry-presentation.ts`, `web/turns.js`, `web/transcript.js`, `web/composer.js`, `web/theme.js`, `web/sheets/appearance.js`, `web/style.css`                           |
| Formatting and build | `package.json`, `package-lock.json`, `.oxfmtrc.json`, `.oxlintrc.json`, `nix/package.nix`; Oxfmt's line breaks in many source files                                                                |
| Workflow and docs    | `AGENTS.md`, `CONTRIBUTING.md`, `docs/self-editing.md`, `docs/architecture.md`, `README.md`, `FORK.md`, `docs/features.md`, `docs/map.md`                                                          |

A merge deletes `.github/workflows/`, `.prettierrc.json`, `.prettierignore`, and `eslint.config.js` if upstream
brings them back.

## Syncing from upstream

```bash
git fetch upstream --tags
git merge --no-ff vX.Y.Z -m "Merge upstream Pi Pocket X.Y.Z"
npm install                     # only when package.json's dependencies changed
npm run format
npm run check && npm run lint
```

Run the tests [docs/self-editing.md](docs/self-editing.md#checking-a-change) asks for. `npm test` is the
slow release check, not a push check. Restart the server after a change outside `extensions/`, as
[AGENTS.md](AGENTS.md) says. Then `git push origin main`.

Each row above names a change a sync must keep. Read this page before resolving a conflict, and do not
restate its rules in another page.

## The fork's own rules

- **No GitHub Actions.** No file under `.github/workflows/` remains; when a sync brings one back, delete it.
  This repository is a working copy rather than a distribution. It takes no pull requests, cuts no releases,
  and deploys no docs site.
- **Oxfmt and Oxlint replace Prettier and ESLint.** They use `.oxfmtrc.json` and `.oxlintrc.json`. The padding
  rule runs through `@stylistic/eslint-plugin`; `eslint` stays in `devDependencies` only as its peer and is not
  run. Take the fork's configs and scripts through a sync, and run `npm run format` after resolving a formatting
  conflict.
- **Run the tests a change touches.** `npm run test:core`, `npm run test:ui`, and `npm test` pick their files
  in `test/run.ts`, one file at a time, because parallel runs are flaky on this machine. Run the tests
  [docs/self-editing.md](docs/self-editing.md#checking-a-change) asks for. The full suite is for a release or
  when the owner asks.
- **README, this page, and CONTRIBUTING are the fork's own.** Take them through a sync. Each page answers one
  question. README gives the list, this page gives the differences and merge rules, and features gives the user
  tour. Map gives file ownership, architecture gives the dependencies, and AGENTS and self-editing give the
  workflow.
- **Do not rename or drop stored data.** `pocket.purge` is the example. It stays in `docs.ts`, and nothing
  reads or writes it.
