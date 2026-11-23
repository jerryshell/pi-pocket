# Pi Pocket

A fork of [TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket), a self-hosted, multiplayer web app for Pi.

## What this fork adds

**Loop: Pi keeps working on its own.** `/loop-on make the tests pass` keeps Pi going, answer after answer, until a person stops it:

- after each answer Pi takes the next step toward the goal, checks its own work, and goes on: it does not ask for permission, and it does not ask whether to go on;
- each round arrives as a message that starts with `[loop]`, and the work counts for the person who started the loop;
- the status line under the message box says `∞ loop`; its sheet shows the aim and stops the loop;
- Stop ends it at once, and `/loop-off` ends it after the current answer; so does a run that ends without going on, such as one whose model call failed or one past a spend limit, with a notice that says so;
- plan mode holds the loop until the plan is answered, and a server restart goes on with it;
- no limit on rounds, money, or time: every round is a message and model calls, so a loop left on spends tokens and money, and the session's spend limit, if the owner set one, is the only brake besides people.

Turn it off in Menu → Extensions like any module.

**Command Code models, built in.** [Command Code](https://commandcode.ai) works as a provider without an extra package or a hand-written `models.json`:

- sign in from Menu → Providers with an API key, or with the browser flow when the browser runs on the server's machine;
- models come from Command Code's own catalog, kept at `~/.pi/agent/commandcode-models.json` and refreshed with **Refresh models**;
- each model uses the wire Command Code serves it on (Chat Completions, Responses, or Anthropic Messages), with its thinking levels, image input, context limits, and display prices;
- zero data retention is on by default: every Provider API request asks for it, and `/commandcode-zdr off` (kept in Pi's `settings.json`) or `CMD_ZDR=0` in the server's environment turns it off; the Go plan's `/alpha/generate` fallback never carries it;
- `/commandcode-quota` shows the account's credits, plan, usage, and 5-hour and weekly windows in the session, and Menu → **Command Code usage** shows them in a sheet, with the remainder in its hint.

The provider is vendored from [`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider) (MIT) into `src/server/commandcode/`. Turn it off in Menu → Extensions like any module.

**Permanent deletion of archived sessions.** Upstream takes a removed session out of the app and leaves its transcript in the database, until Pi Durable grows a way to purge one. This fork finishes the job: the rows of its conversations go too, so the data is gone from `pocket.sqlite`, not waiting.

- **Delete permanently** is on an archived row's trash button, in its touch hold menu, and as **Delete** in the selection bar; it runs the same removal as Session cleanup, whose confirm shows what goes first;
- the worktree (its branch stays), uploads, background logs, transcript, documents, tasks, submissions, per-session spending record, and the hooks or repository watches that pointed at it all go; a session it started stays, with no link to it;
- a session where Pi works, or whose worktree has uncommitted changes or an env file, stays and says why;
- a removal a restart cut short is finished at the next server start, and a session removed by the version before this one (its rows queued in `pocket.purge`) is cleaned up the same way.

**Changes across a folder of repositories.** A session's folder can hold several checkouts of their own, as `~/siluyunpay` does with a dozen projects, and Changes now reviews each of them:

- the folder gets a row of chips, one for each repository right under it, with how many files changed in it, and the review shows the one picked, which this browser remembers for the session; the count in the top bar covers them all;
- the rest is as for one repository: the file tree, the filter, **π only**, viewed marks, side by side or unified diffs, and ↺ to put a file back;
- the list is one folder deep, without hidden folders or `node_modules`, at most 20 of them, kept for three seconds;
- a folder that is itself in a repository reads as before, and so does one with no repository under it.

**History: a repository's commits, and what each changed.** A **History** button in Changes shows the commits of the repository it reviews, where the review shows what is not committed yet:

- newest first, each with its short hash, subject, author, and when: up to 50, on the branch it has checked out;
- a commit opens its own diff under its row, every file it touched, in the same viewer as Changes;
- the repository chips stay, so a folder of checkouts shows each one's history in turn;
- a clean repository has nothing to review but its history, which is where this is useful.

**A browser page that closes after use.** Pi's `browser` tool left its page open for half an hour after the last use, and the Chromium behind it for five minutes more:

- the end of Pi's run now closes the page it opened, unless a tab is watching it or a person used it in the panel: a page may hold a sign-in or a half-filled form, and those are theirs to come back to;
- the tool takes `close`, for a page it is done with before the run ends;
- the browser stops a minute after its last page closed, not five, and the next page starts it again in a moment.

Turn the browser off in Menu → Extensions like any module.

Everything else is upstream's. Use the [upstream repository](https://github.com/TannerMidd/pi-pocket) for the original project, documentation, and releases.
