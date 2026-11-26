<div align="center">

# Pi Pocket, this fork

**A fork of [Pi Pocket](https://github.com/TannerMidd/pi-pocket), the self-hosted, multiplayer web app for Pi.**

</div>

This checkout merges upstream's release tags into `main`. This fork makes each change below and keeps it
through every sync. The vendored Command Code provider has its own sync rules in
[src/server/commandcode/README.md](src/server/commandcode/README.md).

## What this fork adds

- **Command Code is built in.** It has a live catalog, API-key or browser sign-in, zero data retention by
  default, and the Go plan's `/alpha/generate` fallback. Its sheet shows credits, usage windows, and any key's
  usage. Pi Pocket retries a 503 that only failed to check the balance. It does not fail the run as a billing
  error.
- **Loop.** `/loop-on <aim>` keeps Pi working, answer after answer, until someone stops it.
- **Session removal.** Removing a session deletes its rows from `pocket.sqlite`. A live fork keeps the
  parent history it reads until someone removes the last fork.
- **Changes across a folder of repositories.** One review has a chip per checkout. History lists a
  repository's commits and each one's diff.
- **Artifacts.** You can delete one version and keep the others. The chat names who removed it, and All
  artifacts has a delete button.
- **Cache miss notices.** An answer that paid a large prompt-cache miss says what was billed again. It also
  says whether a model switch or a long idle came before.
- **Pi's browser page closes after use.** Pi's page closes when its run ends. The tool takes `close`.

[FORK.md](FORK.md) is the full list: what each addition does, where its code and tests are, and every file a
merge must keep. [docs/features.md](docs/features.md) is the app's feature tour, and [docs/map.md](docs/map.md)
maps the code.

## Install and work on it

Install and configure it as [upstream's README](https://github.com/TannerMidd/pi-pocket#readme) says.
[AGENTS.md](AGENTS.md) and [docs/self-editing.md](docs/self-editing.md) tell how to edit this checkout and
which checks to run. This fork formats and lints with Oxfmt and Oxlint.

[MIT](LICENSE)
