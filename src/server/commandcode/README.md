# Command Code provider

Vendored from [`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider)
0.7.10 (commit `63c8e5c`), under the MIT license in `LICENSE`.

Copied: `models.ts` (the catalog, its cache, each model's wire and thinking levels),
`oauth.ts` and `auth-server.ts` (sign-in, and the local callback the browser flow posts
back to), `api-key.ts` (the stored key), `pricing.ts` (display prices),
`commandcode-catalog.ts` with `commandcode-catalog-overrides.ts` (Pi's image input,
reasoning, and output limits per model, from Command Code's CLI catalog), and `quota.ts`,
`quota-format.ts` and `quota-types.ts` (the account's credits and usage windows, with
`overflow.ts` for its error text).

Pi Pocket adapts it in `../extensions/commandcode.ts`:

- It registers through `host.registerModelProvider`, not Pi's extension API.
- Streaming uses Pi's own Chat Completions, Responses, and Anthropic Messages
  transports, chosen by each model's `supported_endpoints`.
- The sign-in asks first: paste an API key, or the provider's browser flow, which needs a
  browser on the server's machine because its callback is a local port.
- The catalog refreshes from Menu → Providers → **Refresh models**; the last good catalog
  stays at `<agent-dir>/commandcode-models.json`.
- `/commandcode-quota` (the owner's) reads `/alpha/whoami`, `billing/credits`,
  `billing/subscriptions`, and `usage/summary`, and shows them as a card. The card leaves
  out the account's login, because everyone in the session sees it.

Not included: the `/alpha/generate` fallback, the Responses stream normalization, the
`/commandcode-refresh` and `/commandcode-status` commands (the Providers sheet has the
refresh), and the request-time DeepSeek peak rates (Pi shows the table's rates).
