# Pi Pocket, this fork

This checkout is Pi Pocket, maintained independently as a fork of
[TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket). It follows that project's releases by
merging their tags into `main`, and it never sends changes back, so every difference below is carried
here for good: a sync must keep it.

The fork adds Loop, Command Code models, a removal that deletes a session's rows, Changes across a folder
of repositories, History, and a browser page that closes when Pi's run ends. This page says what each
does, where its code is, why upstream does not have it, and what a merge from upstream must preserve.

## What the fork adds

### Loop

Since 0.28.0, `/loop-on make the tests pass`: Pi works on by itself, answer after answer, until someone
stops it. After each of its answers it takes the next step toward the goal, checks its own work, says in
one line what it did, and goes on: it does not ask for permission and does not ask whether to go on. Each
round arrives as a message in the session that starts with `[loop]`, sent for the person who started the
loop, which is whose work it is. `/loop-off` ends the loop after Pi's answer, and Stop ends it at once. A
run that ends without going on ends the loop too, such as one whose model or provider failed, or one past
a spend limit; a notice says so, and `/loop-on` starts it again. In plan mode the loop waits until the
plan is answered. While a loop is on, the status line under the message box says **∞ loop**; tapping it
opens its sheet, which shows the aim, when the loop began, and **Stop the loop**, which ends it as
`/loop-off` does. A loop is a `pocket.loop` document and a durable task, so a restart goes on with it, and
the task starts the first round by itself when the command runs while Pi is idle. There is no limit on
rounds, on money, or on time: every round is a message and model calls, so a loop left on spends tokens
and money, and the session's spend limit, if the owner set one, is the only brake besides people. Turn it
off in Extensions.

Code: `src/server/extensions/loop.ts`, `src/server/extensions/loop/`, the `loop.ts` entry in
`reload.ts`'s `ORDER`, and `test/loop*.test.ts`.

### Command Code models

[Command Code](https://commandcode.ai) works as a provider without an extra package or a hand-written
`models.json`:

- sign in from Menu → Providers with an API key, or with the browser flow when the browser runs on the
  server's machine;
- models come from Command Code's own catalog, kept at `~/.pi/agent/commandcode-models.json` and refreshed
  with **Refresh models**;
- each model uses the wire Command Code serves it on (Chat Completions, Responses, or Anthropic Messages),
  with its thinking levels, image input, context limits, and display prices;
- zero data retention is on by default: every Provider API request asks for it, and `/commandcode-zdr off`
  (kept in Pi's `settings.json`) or `CMD_ZDR=0` in the server's environment turns it off; the Go plan's
  `/alpha/generate` fallback never carries it;
- `/commandcode-quota` shows the account's credits, plan, usage, and 5-hour and weekly windows in the
  session, and Menu → **Command Code usage** shows them in a sheet, with the remainder in its hint.

The provider is vendored from [`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider)
(MIT) into `src/server/commandcode/`; `src/server/commandcode/README.md` says what is copied, what is
adapted, and how a sync of it works. The Go plan has no Provider API access, so Command Code answers
`403 upgrade_required`: the `/alpha/generate` client that upstream 0.8.0 removed stays in
`commandcode/generate/`, and `generate/router.ts` decides when to use it. Turn it off in Menu →
Extensions like any module.

Code: `src/server/commandcode/`, `src/server/extensions/commandcode.ts`, `src/server/extensions/commandcode/`,
the `commandcode` entry in `limit-gate.ts`'s `RECORDS_FETCH` and in `reload.ts`'s `ORDER`, and
`test/commandcode*.test.ts`.

### A removal that deletes for good

Upstream takes a removed session out of the app and leaves its transcript in the database, until Pi Durable
grows a way to purge one. This fork finishes the job: once a session's worktree, files, uploads, and logs
are gone, its conversations' rows go too (entries, tasks, submissions, documents, and their revisions),
with its per-session spend record, so the data is gone from `pocket.sqlite` rather than waiting. Pi Durable
has no delete of a conversation, so `purge.ts` removes those rows from its tables directly.

The removal itself is upstream's Session cleanup: it plans and checks a session (worktree state, an env
file git ignores, uploads a live fork reads, links, schedules, lessons), and `resume` finishes at the next
start whatever a restart cut short (`pocket.deleted` is the queue). The fork's own entry points stay, and
they run that same removal: the trash button on an archived row, **Delete permanently** in its hold menu,
and **Delete** in the selection bar post `POST /api/sessions/:id/delete`, which is core's route, so they
work with the Session cleanup module off. A session the removed one started stays, with no link to it.

Code: `src/server/purge.ts`, `PocketApp.purgeStoredData`, the call in `session-cleanup.ts`'s `#finish`,
`SpendDoc.forget`, the guard at the top of `commands.ts`'s `#fork`, the delete route in `http/api.ts`,
`web/sessions.js`, `web/sheets/session.js`, and `test/session-cleanup.test.ts`.

`pocket.purge` stays defined in `docs.ts` because stored data is not deleted; nothing writes or reads it
since the removals above took its place.

### Changes across a folder of repositories

A session's folder can hold several checkouts of their own, as `~/siluyunpay` does with a dozen projects,
and Changes reviews each of them:

- the folder gets a row of chips, one for each repository right under it, with its branch, how far that is
  from the remote branch it follows (↑2 ↓1, or that the remote branch is gone), and how many files changed
  in it, and the review shows the one picked, which this browser remembers for the session; the changes
  button stays in the top bar for such a folder, so the list is a tap away even with nothing changed;
- the rest is as for one repository: the file tree, the filter, **π only**, viewed marks, side by side or
  unified diffs, and ↺ to put a file back;
- the list is one folder deep, without hidden folders or `node_modules`, at most 20 of them, kept for three
  seconds;
- a folder that is itself in a repository reads as before, and so does one with no repository under it.

Code: `src/server/changes.ts` (`reposUnder`, `repoState`), `src/server/workspace.ts`, `web/diff.js`,
`web/store.js`, `web/style.css`, and `test/changes.test.ts`.

### History

A **History** button in Changes shows the commits of the repository it reviews, where the review shows
what is not committed yet:

- newest first, each with its short hash, subject, author, and when: up to 50, on the branch it has
  checked out;
- a commit opens its own diff under its row, every file it touched, in the same viewer as Changes;
- the repository chips stay, so a folder of checkouts shows each one's history in turn;
- a clean repository has nothing to review but its history, which is where this is useful.

Code: `src/server/branches.ts` (the `/commits` route), `src/server/changes.ts` (`commitsIn`,
`commitDiffIn`), `web/history.js`, `web/sheets/branch.js`, `web/diff.js`, and `test/history.test.ts`.

### A browser page that closes after use

Pi's `browser` tool left its page open for half an hour after the last use, and the Chromium behind it for
five minutes more. In this fork:

- the end of Pi's run closes the page it opened, unless a tab is watching it or a person used it in the
  panel: a page may hold a sign-in or a half-filled form, and those are theirs to come back to;
- the tool takes `close`, for a page it is done with before the run ends;
- the browser stops a minute after its last page closed, not five, and the next page starts it again in a
  moment.

Code: `src/server/browser.ts`, `src/server/browser/page.ts`, `src/server/extensions/browser.ts`,
`src/server/http/browser-routes.ts`, `src/server/host.ts` (`browsers` gains `page` and `close`), and
`test/browser.test.ts`.

### A line in the chat when an artifact is deleted

Upstream's artifact delete leaves Pi's own messages and the replies' "deleted" cards, and no trace in the
chat. The fork writes one activity line, "removed the artifact “X”", as it does for archiving a session,
and the chat keeps that title: the artifact's own documents keep nothing of it.

Code: `src/server/artifacts.ts` and `test/artifact-delete.test.ts`, whose revision scan says the title
survives nowhere but that line.

## Upstream files this fork changes

A merge must keep each of these. The new files are the fork's own and need no resolution.

| Upstream file                                                                                            | The fork's change                                                                                                                                         |
| -------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                                                                                              | The fork's front page (a summary and where to look). Take ours.                                                                                           |
| `docs/features.md`                                                                                       | A pointer to this page at the top, and the sentences where a fork behavior corrects upstream's (a removal's rows, and the session list's delete buttons). |
| `docs/map.md`                                                                                            | Rows for `purge.ts` and `commandcode/`, the extension `ORDER` and `RECORDS_FETCH` entries, and the test paragraph.                                        |
| `docs/self-editing.md`                                                                                   | The tests-by-area table, and the rule that a patch release merge or a provider sync runs only the files it touches.                                       |
| `docs/architecture.md`, `CONTRIBUTING.md`, `docs/design/*.md`                                            | The same test rule, one line each.                                                                                                                        |
| `AGENTS.md`                                                                                              | The notes on the vendored provider, the session cleanup, the artifact line, and the test policy.                                                          |
| `package.json`                                                                                           | The test scripts, through `test/run.ts`.                                                                                                                  |
| `src/server/app.ts`                                                                                      | `purgeStoredData`, which purges a removed session's rows and spend record.                                                                                |
| `src/server/commands.ts`                                                                                 | The `pocket.deleted` guard at the top of `#fork`, so a fork that a removal overtakes is refused with 409.                                                 |
| `src/server/session-cleanup.ts`                                                                          | The purge call in `#finish`, and the `linkedFrom` cleanup in the removal's commit.                                                                        |
| `src/server/docs.ts`                                                                                     | `PurgeDoc`, kept and unused.                                                                                                                              |
| `src/server/reload.ts`                                                                                   | `loop.ts` and `commandcode.ts` in `ORDER`.                                                                                                                |
| `src/server/limit-gate.ts`                                                                               | `commandcode` in `RECORDS_FETCH`, so a Command Code failure's status and headers are read.                                                                |
| `src/server/spend.ts`                                                                                    | `forget`, for a removed conversation.                                                                                                                     |
| `src/server/artifacts.ts`                                                                                | The activity line after a delete.                                                                                                                         |
| `src/server/http/api.ts`                                                                                 | `POST /api/sessions/:id/delete`, which runs the session cleanup's removal.                                                                                |
| `src/server/changes.ts`, `workspace.ts`, `branches.ts`                                                   | The repositories under a folder, and the commits route.                                                                                                   |
| `src/server/browser.ts`, `browser/page.ts`, `extensions/browser.ts`, `http/browser-routes.ts`, `host.ts` | The page that closes at the end of Pi's run.                                                                                                              |
| `web/**`                                                                                                 | `diff.js`, `history.js`, `store.js`, `app.js`, `sessions.js`, `style.css`, `sheets/*.js`, `ui.js`: the fork's UI for all of the above.                    |
| `test/**`                                                                                                | The tests of the features above, and `test/run.ts`'s groups.                                                                                              |

## Syncing from upstream

```bash
git fetch upstream --tags
git merge --no-ff vX.Y.Z -m "Merge upstream Pi Pocket X.Y.Z"
npm install                     # only when package.json's dependencies changed
npm run check && npm run lint && npm run format
```

Then the tests (the full suite before a push, or the files the area names in
[docs/self-editing.md](docs/self-editing.md#checking-a-change)), `pm2 restart pi-pocket` for a change under
`src/server/`, and `git push origin main`.

Conflicts are expected in the files the table above names. Read this page before resolving one: every row
is a decision that a sync must keep, not a merge artifact.

## The fork's own policies

- **No GitHub Actions.** Every file under `.github/workflows/` is deleted, including one a sync brings
  back: the fork takes no pull requests, makes no releases, and publishes no docs site.
- **Tests run in groups.** `npm run test:core`, `npm run test:ui`, and `npm test` pick their files in
  `test/run.ts`, one file at a time in this checkout, where the parallel run is flaky.
- **`README.md` and this page are the fork's.** A merge takes ours for both.
- **Stored data is never renamed or dropped.** `pocket.purge` is the example: kept in `docs.ts`, written
  and read by nothing.
