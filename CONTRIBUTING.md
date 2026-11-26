# Working on this fork

This is a fork of [Pi Pocket](https://github.com/TannerMidd/pi-pocket), maintained separately. It takes no
pull requests and cuts no releases. Changes happen here, and each sync of upstream's release tags keeps them. [FORK.md](FORK.md) lists what differs and what a merge must keep.

## Make the change

- Read [AGENTS.md](AGENTS.md), [docs/self-editing.md](docs/self-editing.md), and [docs/map.md](docs/map.md).
- Add one small test for each real risk that the change brings. The test must fail before the change.
- Run `npm run format`, `npm run check`, `npm run lint`, and the tests
  [docs/self-editing.md](docs/self-editing.md#checking-a-change) asks for. `npm test` is the slow release
  check, not a push check.
- To report a security problem, do not open an issue. Read [SECURITY.md](SECURITY.md).

## Keep the docs accurate

- Fork differences and merge rules live in [FORK.md](FORK.md). Other pages answer their own question and
  point there instead of restating it.
- [docs/map.md](docs/map.md), [docs/architecture.md](docs/architecture.md), and
  [docs/features.md](docs/features.md) follow a change that moves code, a dependency, or what people see.

## Send it

Commit to `main` with a short title and a body that says what changed, why, and what you tested.
