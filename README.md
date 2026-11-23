# Pi Pocket (fork)

A fork of [TannerMidd/pi-pocket](https://github.com/TannerMidd/pi-pocket), a self-hosted, multiplayer web
app for Pi, maintained separately: it follows upstream's releases, and its own changes live here.

## What this fork adds

- **Loop.** `/loop-on <aim>` keeps Pi working on its own, answer after answer, until someone stops it.
- **Command Code models.** A built-in provider: its catalog, sign-in, quota, and zero-data-retention
  default, with the Go plan's `/alpha/generate` fallback.
- **A removal that deletes.** A removed session's transcript, tasks, documents, and spend record go from
  the database, not only its files.
- **Changes across a folder of repositories.** One review with a chip per checkout, and **History**: a
  repository's commits, each opening its own diff.
- **A browser page that closes after use.** Pi's page goes when its run ends, and the tool takes `close`.
- **A chat line for a deleted artifact**, naming who removed it.

Each one, with its code, tests, why upstream does not have it, and what a merge must keep, is in
[FORK.md](FORK.md). [docs/features.md](docs/features.md) is the feature tour, [docs/map.md](docs/map.md) the
code map, and [AGENTS.md](AGENTS.md) how to edit this checkout.

Install and configure it as upstream says: [its README](https://github.com/TannerMidd/pi-pocket#readme).

[MIT](LICENSE).
