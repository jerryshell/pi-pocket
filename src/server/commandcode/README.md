# Command Code provider

Vendored from [`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider),
under the MIT license in `LICENSE`. The catalog, the sign-in, and the account's endpoints are
upstream 0.8.1 (commit `e8ebc6e`); `generate/` is upstream 0.7.12 (commit `0f568ff`), where the
`/alpha/generate` client still shipped.

Copied: `models.ts` (the catalog, its cache, each model's wire and thinking levels),
`oauth.ts` and `auth-server.ts` (sign-in, and the local callback the browser flow posts
back to), `api-key.ts` (the stored key), `pricing.ts` (display prices),
`commandcode-catalog.ts` with `commandcode-catalog-overrides.ts` (Pi's image input,
reasoning, and output limits per model, from Command Code's CLI catalog at
`command-code@1.88.5`), and `quota.ts`, `quota-format.ts` and `quota-types.ts` (the
account's credits and usage windows, with `overflow.ts` for its error text).

Pi Pocket adapts it in `../extensions/commandcode.ts`:

- It registers through `host.registerModelProvider`, not Pi's extension API, under one api
  of its own, `commandcode`, which it also puts in Pi's api registry. The stream behind that
  api hands each request to Pi's own Chat Completions, Responses, or Anthropic Messages
  transport, chosen by the model's `supported_endpoints` (`wires` says which), and falls back
  to the generate client when Command Code answers `403 upgrade_required`.
- **The Go plan stays usable, and a sync keeps it that way.** Upstream 0.8.0 stops at `403 upgrade_required`, because the Go
  plan has no Provider API access; it removed the `/alpha/generate` client, the request
  serializers, and their retries. Pi Pocket keeps that client (`generate/`) instead: an
  account the Provider API refuses is served by Command Code's own endpoint, as it was through
  0.7.12. Once a key falls back, later requests with it go straight there; a key change probes
  the Provider API again. `generate/router.ts` holds that decision, and `test/commandcode-generate.test.ts`
  pins it: `403 upgrade_required` falls back, any other 403 does not.
- The sign-in asks first: paste an API key, or the provider's browser flow, which needs a
  browser on the server's machine because its callback is a local port.
- The catalog refreshes from Menu → Providers → **Refresh models**; the last good catalog
  stays at `<agent-dir>/commandcode-models.json`. A refresh also forgets which path the key
  took, so an account that changed plan asks the Provider API again instead of keeping the
  fallback until it changes keys or restarts. Upstream's `/commandcode-refresh` does the same.
- The usage sheet and `/commandcode-quota` say where the account's requests go: the Provider
  API, the Go fallback (`/alpha/generate`), or not tried since the last refresh or restart.
- `/commandcode-quota` (the owner's) reads `/alpha/whoami`, `billing/credits`,
  `billing/subscriptions`, and `usage/summary`, and shows them as a card. The card leaves
  out the account's login, because everyone in the session sees it.
- Menu → **Command Code usage** (the owner's too) opens a sheet with the same numbers,
  a bar for the credits and for each window, and Refresh; its hint shows the rest. The
  browser module is `extensions/commandcode/` (`index.js`, `style.css`), served by two
  owner-only routes, `GET usage` and `POST usage` (`{ fresh: true }` skips a 30-second
  cached answer).

Not included: the Responses stream normalization, upstream's `/commandcode-refresh`,
`/commandcode-status`, `/commandcode-endpoint`, and `/commandcode-diagnostics` commands (the
Providers sheet has the refresh), and the request-time DeepSeek peak rates on the Provider API
path (Pi shows the table's rates; the generate path does apply them).

The sign-in checks the callback's origin and state as upstream does (no local development
origin, and only the page that holds the state token can settle a login, errors included),
and validates a pasted key against `COMMANDCODE_API_BASE` within 15 seconds.
