# Pi Pocket

A fork of [TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket), a self-hosted, multiplayer web app for Pi.

## What this fork adds

**Permanent deletion of archived sessions.** Upstream can only archive a session. This fork lets the owner delete archived sessions for good:

- from the trash button on an archived row;
- from **Delete permanently** in the touch hold menu;
- for several rows at once with **Delete** in the selection bar.

The app asks once, then removes the session's transcript, documents, tasks, submissions, uploads, per-session spending record, and hooks or repository watches that pointed at it. It refuses a session that is working, has a worktree, or is the source of a fork. A cleanup that did not finish is retried at the next server start.

Everything else is upstream's. Use the [upstream repository](https://github.com/TannerMidd/pi-pocket) for the original project, documentation, and releases.

## License

[MIT](LICENSE).
