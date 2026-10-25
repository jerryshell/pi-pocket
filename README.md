# Pi Pocket

A fork of [TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket), a self-hosted, multiplayer web app for Pi.

## What this fork adds

**Permanent deletion of archived sessions.** Upstream can only archive a session. This fork lets the owner delete archived sessions for good:

- from the trash button on an archived row;
- from **Delete permanently** in the touch hold menu;
- for several rows at once with **Delete** in the selection bar.

The app asks once, then removes the session's transcript, documents, tasks, submissions, uploads, per-session spending record, and hooks or repository watches that pointed at it. It refuses a session that is working, has a worktree, or is the source of a fork. A cleanup that did not finish is retried at the next server start.

**Command Code models, built in.** [Command Code](https://commandcode.ai) works as a provider without an extra package or a hand-written `models.json`:

- sign in from Menu → Providers with an API key, or with the browser flow when the browser runs on the server's machine;
- models come from Command Code's own catalog, kept at `~/.pi/agent/commandcode-models.json` and refreshed with **Refresh models**;
- each model uses the wire Command Code serves it on (Chat Completions, Responses, or Anthropic Messages), with its thinking levels, image input, context limits, and display prices;
- `/commandcode-quota` shows the account's credits, plan, usage, and 5-hour and weekly windows in the session.

The provider is vendored from [`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider) (MIT) into `src/server/commandcode/`. Turn it off in Menu → Extensions like any module.

Everything else is upstream's. Use the [upstream repository](https://github.com/TannerMidd/pi-pocket) for the original project, documentation, and releases.
