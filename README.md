# Pi Pocket (fork)

A fork of [TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket), a self-hosted, multiplayer web
app for Pi.

This checkout merges upstream's release tags into `main`. The changes below are made here and stay here.

## What this fork adds

- **Command Code models.** A built-in provider with its catalog, sign-in, quota, and zero-data-retention
  default. The Go plan works through the `/alpha/generate` fallback, and its usage sheet reads any key's
  credits.
- **Loop.** `/loop-on <aim>` keeps Pi working on its own, answer after answer, until someone stops it.
- **Deletion from the database.** A removed session's transcript, tasks, documents, and spend record go along
  with its files.
- **Changes across a folder of repositories.** One review with a chip per checkout, plus History, which shows
  a repository's commits and the diff of each.
- **A browser page that closes after use.** Pi's page goes when its run ends, and the tool takes `close`.
- **Cache miss notices.** An answer that paid for a large prompt-cache miss says what was billed again, and
  whether a model switch or a long idle came before.
- **A chat line for a deleted artifact**, naming who removed it.

Each addition is detailed in [FORK.md](FORK.md): its code, its tests, why upstream does not have it, and what
a merge must keep. [docs/features.md](docs/features.md) is the feature tour, [docs/map.md](docs/map.md) the
code map, and [AGENTS.md](AGENTS.md) how to edit this checkout.

Install and configure it as [upstream's README](https://github.com/TannerMidd/pi-pocket#readme) says.

[MIT](LICENSE).
