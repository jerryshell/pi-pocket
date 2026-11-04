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
- `/commandcode-quota` shows the account's credits, plan, usage, and 5-hour and weekly windows in the session, and Menu → **Command Code usage** shows them in a sheet, with the remainder in its hint.

The provider is vendored from [`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider) (MIT) into `src/server/commandcode/`. Turn it off in Menu → Extensions like any module.

**Permanent deletion of archived sessions.** Upstream can only archive a session. This fork lets the owner delete archived sessions for good:

- from the trash button on an archived row;
- from **Delete permanently** in the touch hold menu;
- for several rows at once with **Delete** in the selection bar.

The app asks once, then removes the session's transcript, documents, tasks, submissions, uploads, per-session spending record, and hooks or repository watches that pointed at it. It refuses a session that is working, has a worktree, or is the source of a fork. A cleanup that did not finish is retried at the next server start.

Everything else is upstream's. Use the [upstream repository](https://github.com/TannerMidd/pi-pocket) for the original project, documentation, and releases.
