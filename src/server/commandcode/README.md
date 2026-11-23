# Command Code provider

This page is the provider's own source of truth: what is copied, what is adapted, and what a sync of that
code must keep. The fork's overview is [FORK.md](../../../FORK.md).

Vendored from [`patlux/pi-commandcode-provider`](https://github.com/patlux/pi-commandcode-provider),
under the MIT license in `LICENSE`. The catalog, the sign-in, and the account's endpoints are
upstream 0.8.7 (commit `7a06135`); `generate/` is upstream 0.7.12 (commit `0f568ff`), where the
`/alpha/generate` client still shipped.

**What a sync must keep.** The `/alpha/generate` fallback for the Go plan (`generate/`, and the decision in
`generate/router.ts`, pinned by `test/commandcode-generate.test.ts`), both Responses wirings (the body
repairs through Pi's `onPayload`, the frame repairs through the transport's `fetch`), zero data retention
on by default with `CMD_ZDR` deciding first, and the sign-in checks below.

Copied: `models.ts` (the catalog, its cache, each model's wire and thinking levels),
`oauth.ts` and `auth-server.ts` (sign-in, and the local callback the browser flow posts
back to), `api-key.ts` (the stored key), `pricing.ts` (display prices),
`commandcode-catalog.ts` with `commandcode-catalog-overrides.ts` (Pi's image input,
reasoning, and output limits per model, from Command Code's CLI catalog at
`command-code@1.91.1`), `responses-compat.ts` (two Responses body repairs the models of
`zai-org/GLM-5.3` and `mistral/mistral-large-4` need, and the stream trait of the model whose
thinking arrives as plaintext `encrypted_content`), `responses-stream.ts` (the Responses
reasoning-frame adapter), `zdr.ts` (the zero-data-retention opt-in, its settings file, and its
header), and `quota.ts`, `quota-format.ts` and `quota-types.ts` (the account's credits and usage
windows, with `overflow.ts` for its error text).

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
  browser on the server's machine because its callback is a local port. A refresh checks the
  stored key against `whoami` first, as upstream 0.8.4 does: a revoked key fails with
  `401 invalid_token` instead of coming back with a new expiry.
- Zero data retention is on by default: every Provider API inference request carries
  `x-cmd-zdr: 1`, as the [Provider API docs](https://commandcode.ai/docs/markdown/provider/index.md)
  document, and so do the account reads behind `/commandcode-quota`. `/commandcode-zdr on|off`
  (the owner's) shows it and writes `commandcode.enableZDR` into Pi's `settings.json`, as 0.8.7
  does; the environment still decides first, so `CMD_ZDR=0` (or its `COMMANDCODE_ZDR` alias)
  turns it off and a setting that could not take effect is refused. While it is on, a model with
  no ZDR-capable upstream fails with `422 cmd_zdr_no_providers` instead of reaching a non-ZDR
  provider. The `/alpha/generate` fallback is Command Code's own endpoint, not the Provider API:
  it gets no such header, and its taste learning stays off while ZDR is on.
- A model on the Responses wire gets two body repairs through Pi's `onPayload`, from
  `responses-compat.ts`, where upstream repairs the body at `fetch`: GLM-5.3 refuses Pi's
  untagged message items, and GLM-5.3 and Mistral Large 4 refuse `reasoning.effort: "none"`.
- The same wire gets its response frames through `fetch`, from `responses-stream.ts`: Command
  Code's non-standard `response.reasoning.delta` becomes the canonical reasoning-text delta,
  and GLM-5.3's plaintext `encrypted_content` becomes thinking just before its reasoning item
  completes, only for the model `modelWireTraits` names (for OpenAI models that field is real
  ciphertext). Both run only for `/responses` models, on top of any `fetch` the caller passed.
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

Not included: upstream's `/commandcode-refresh`, `/commandcode-status`, `/commandcode-endpoint`,
and `/commandcode-diagnostics` commands (the Providers sheet has the refresh), and the
request-time DeepSeek peak rates on the Provider API path (Pi shows the table's rates; the
generate path does apply them). The wire repairs of 0.8.3 and the stream repairs of 0.8.6 are
included: body repairs through `onPayload`, stream repairs through `fetch`.

The sign-in checks the callback's origin and state as upstream does (no local development
origin, and only the page that holds the state token can settle a login, errors included),
and validates a pasted key against `COMMANDCODE_API_BASE` within 15 seconds.
