# Pi Pocket, this fork

Pi Pocket, maintained separately as a fork of
[TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket). It follows that project's releases by
merging its release tags into `main`. Changes that upstream does not have are made here and stay here, and
a sync carries them forward.

This page lists them: what each does, where its code is, why upstream does not have it, and what a merge
must keep.

## Where each thing lives

| Question                                                                        | Answer                                                               |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| What does the fork add, in one line each?                                       | [README.md](README.md)                                               |
| What does each addition do, where is it, what must a merge keep?                | This page                                                            |
| What does each file own?                                                        | [docs/map.md](docs/map.md)                                           |
| What does the app let people do (upstream's tour, plus a pointer here)?         | [docs/features.md](docs/features.md)                                 |
| How is this checkout edited and tested safely?                                  | [AGENTS.md](AGENTS.md), [docs/self-editing.md](docs/self-editing.md) |
| What does the vendored Command Code provider copy, and what must its sync keep? | [src/server/commandcode/README.md](src/server/commandcode/README.md) |
| What depends on what?                                                           | [docs/architecture.md](docs/architecture.md)                         |

## The additions

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

The code lives in `src/server/extensions/loop.ts` and `src/server/extensions/loop/`, with `loop.ts` in
`reload.ts`'s `ORDER`. Tests are in `test/loop.test.ts` and `test/loop-ui.test.ts`. Upstream has no
counterpart.

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
  carries it.
- `/commandcode-quota` shows the account's credits, plan, usage, and 5-hour and weekly windows, and Menu →
  **Command Code usage** shows them in a sheet.

Upstream has no Command Code provider. This one is vendored from
[`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider) (MIT), and the Go plan
needs the `/alpha/generate` client upstream removed. [Its README](src/server/commandcode/README.md) says what
is copied, what is adapted, how the fallback works, and what a sync of that code must keep.

The code lives in `src/server/commandcode/`, `src/server/extensions/commandcode.ts`, and
`src/server/extensions/commandcode/`, with `commandcode` entries in `limit-gate.ts`'s `RECORDS_FETCH` and
`reload.ts`'s `ORDER`. Tests are in `test/commandcode*.test.ts`. Turn it off in Menu → Extensions like any
module.

### A removal that deletes for good

Upstream takes a removed session out of the app with its files and leaves the transcript in the database,
until Pi Durable grows a way to purge a conversation. This fork finishes the job. Once a session's worktree,
files, uploads, and logs are gone, its conversations' rows go too: entries, tasks, submissions, documents,
revisions, and its per-session spend record. The rows are then gone from `pocket.sqlite`. Pi Durable has no
delete of a conversation, so `purge.ts` deletes those rows from Pi Durable's tables directly.

The removal itself is upstream's Session cleanup. Before anything goes, the plan reports the worktree's
state, any env file git ignores, the uploads a live fork reads, links, schedules, and lessons. Its
`pocket.deleted` document is the queue, and `resume` finishes at start whatever a restart cut short. The fork
adds:

- the purge after the files, and the `linkedFrom` cleanup in the removal's commit;
- its own entry points, which run that same removal through the core route
  `POST /api/sessions/:id/delete`: the trash button on an archived row, **Delete permanently** in its hold
  menu, and **Delete** in the selection bar. They work with the Session cleanup module off;
- the confirm's copy, which says a removal takes the transcript, tasks, and documents too.

The code lives in `src/server/purge.ts`, `PocketApp.purgeStoredData`, the call in `session-cleanup.ts`'s
`#finish`, `SpendDoc.forget`, the guard at the top of `commands.ts`'s `#fork`, the route in `http/api.ts`,
`web/sessions.js`, and `web/sheets/session.js`. Tests are in `test/session-cleanup.test.ts` and
`test/sessions.test.ts`. `pocket.purge` stays defined in `docs.ts` because stored kinds are not removed, and
nothing reads or writes it.

### Changes across a folder of repositories

A session's folder can hold several checkouts of their own, and Changes reviews each of them.

- The folder gets a row of chips, one per repository right under it, with its branch, how far that is from
  the remote branch it follows, and how many files changed in it. The review shows the one picked, and this
  browser remembers it for the session.
- The rest works as it does for one repository: the file tree, the filter, **π only**, viewed marks, side by
  side or unified diffs, and ↺ to put a file back.
- The list covers one folder deep, without hidden folders or `node_modules`, at most 20 of them, kept for
  three seconds.
- A folder that is itself in a repository reads as before, and so does one with no repository under it.

The code lives in `src/server/changes.ts` (`reposUnder`, `repoState`), `src/server/workspace.ts`,
`web/diff.js`, `web/store.js`, and `web/style.css`. Tests are in `test/changes.test.ts`. Upstream has no
counterpart.

### History

History in Changes shows a repository's commits, while the review itself shows what is not committed yet. Commits come newest first with short hash, subject, author, and when, up to 50, on the branch
that is checked out. A commit opens its own diff under its row in the same viewer, the repository chips stay,
and a clean repository has nothing to review but its history.

The code lives in `src/server/branches.ts` (the `/commits` route), `src/server/changes.ts` (`commitsIn`,
`commitDiffIn`), `web/history.js`, `web/sheets/branch.js`, and `web/diff.js`. Tests are in
`test/history.test.ts`. Upstream has no counterpart.

### A browser page that closes after use

Pi's `browser` tool left its page open for half an hour after the last use, and the Chromium behind it for
five minutes more. In this fork:

- The end of Pi's run closes the page it opened, unless a tab watches it or a person used it in the panel. A
  page may hold a sign-in or a half-filled form, and those are theirs to come back to.
- The tool takes `close`, for a page it is done with before the run ends.
- The browser stops a minute after its last page closed, not five, and the next page starts it again.

The code lives in `src/server/browser.ts`, `src/server/browser/page.ts`,
`src/server/extensions/browser.ts`, `src/server/http/browser-routes.ts`, and `src/server/host.ts`
(`browsers` gains `page` and `close`). Tests are in `test/browser.test.ts`. Upstream has no counterpart.

### A line in the chat when an artifact is deleted

Upstream's artifact delete leaves Pi's own messages and the replies' deleted cards, and no trace in the chat.
The fork writes one activity line that names the artifact the person removed, as it does for archiving a
session. The chat keeps that title, and the artifact's own documents keep nothing.

The code lives in `src/server/artifacts.ts`. Tests are in `test/artifact-delete.test.ts`, whose revision scan
says the title survives nowhere but that line.

## Upstream files this fork changes

A merge must keep each of these. New files are the fork's own and need no resolution.

| Upstream file                                                                                            | The fork's change                                                                                                   |
| -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                              | The fork's front page. Take ours.                                                                                   |
| `docs/features.md`                                                                                       | A pointer to this page at the top, and the Session cleanup sentence that says a removal's rows go.                  |
| `docs/map.md`                                                                                            | Rows for `purge.ts` and `commandcode/`, the `ORDER` and `RECORDS_FETCH` entries, and the test paragraph.            |
| `docs/self-editing.md`                                                                                   | The tests-by-area table, and the rule that a patch release merge or a provider sync runs only the files it touches. |
| `docs/architecture.md`, `CONTRIBUTING.md`, `docs/design/*.md`                                            | The same test rule, one line each.                                                                                  |
| `AGENTS.md`                                                                                              | The pointer to this page, and the test policy.                                                                      |
| `package.json`                                                                                           | The test scripts, through `test/run.ts`.                                                                            |
| `src/server/app.ts`                                                                                      | `purgeStoredData`.                                                                                                  |
| `src/server/commands.ts`                                                                                 | The `pocket.deleted` guard at the top of `#fork`, so a fork a removal overtakes is refused with 409.                |
| `src/server/session-cleanup.ts`                                                                          | The purge call in `#finish`, and the `linkedFrom` cleanup in the removal's commit.                                  |
| `src/server/extensions/session-cleanup/index.js`                                                         | The confirm's copy: a removal's transcript, tasks, and documents go here.                                           |
| `src/server/docs.ts`                                                                                     | `PurgeDoc`, kept and unused.                                                                                        |
| `src/server/reload.ts`                                                                                   | `loop.ts` and `commandcode.ts` in `ORDER`.                                                                          |
| `src/server/limit-gate.ts`                                                                               | `commandcode` in `RECORDS_FETCH`.                                                                                   |
| `src/server/spend.ts`                                                                                    | `forget`.                                                                                                           |
| `src/server/artifacts.ts`                                                                                | The activity line after a delete.                                                                                   |
| `src/server/http/api.ts`                                                                                 | `POST /api/sessions/:id/delete`.                                                                                    |
| `src/server/changes.ts`, `workspace.ts`, `branches.ts`                                                   | The repositories under a folder, and the commits route.                                                             |
| `src/server/browser.ts`, `browser/page.ts`, `extensions/browser.ts`, `http/browser-routes.ts`, `host.ts` | The page that closes at the end of Pi's run.                                                                        |
| `web/**`                                                                                                 | The fork's UI: `diff.js`, `history.js`, `store.js`, `app.js`, `sessions.js`, `style.css`, `sheets/*.js`, `ui.js`.   |
| `test/**`                                                                                                | The tests of the additions, and `test/run.ts`'s groups.                                                             |

## Syncing from upstream

```bash
git fetch upstream --tags
git merge --no-ff vX.Y.Z -m "Merge upstream Pi Pocket X.Y.Z"
npm install                     # only when package.json's dependencies changed
npm run check && npm run lint && npm run format
```

Run the tests the change asks for, as [docs/self-editing.md](docs/self-editing.md#checking-a-change) says,
and the full suite before a push. After a change under `src/server/`, run `pm2 restart pi-pocket`. Then
`git push origin main`.

Every row in the table above is a decision a sync must keep. Read this page before resolving a conflict.

## The fork's own rules

- **No GitHub Actions.** No file under `.github/workflows/` remains; when a sync brings one back, delete it.
  This repository is a working copy rather than a distribution. It takes no pull requests, cuts no releases,
  and deploys no docs site.
- **Tests run in groups.** `npm run test:core`, `npm run test:ui`, and `npm test` pick their files in
  `test/run.ts`, one file at a time, because parallel runs are flaky on this machine.
  [docs/self-editing.md](docs/self-editing.md#checking-a-change) says which to run for a change.
- **`README.md` and this page are the fork's.** A merge takes ours for both.
- **Stored data is never renamed or dropped.** `pocket.purge` is the example, kept in `docs.ts` and read and
  written by nothing.
