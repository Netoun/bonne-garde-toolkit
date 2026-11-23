# 9. Cloudflare APIs only in cloudflare-scoped code, with a dockerfile equivalent

Status: accepted

## Context

AGENTS.md forbids Cloudflare proprietary APIs outside the `DB` and `BUCKET` bindings. The repo already breaks that rule: `registry/modules/provider/cloudflare/template/packages/api-runtime/src/index.ts` imports `cloudflare:workers` and `elysia/adapter/cloudflare-worker`. Upcoming capabilities (realtime, cron, queues, email, LLM, PDF) need Durable Objects, Cron Triggers and Queues. The `dockerfile` provider is one Node container with a `DATA_DIR` volume, so it cannot run those bindings.

## Decision

A Cloudflare API (binding, `cloudflare:workers`, wrangler config) appears only in:

- a module whose `peers.provider` is `["cloudflare"]`;
- a variant whose `match` is `{ "provider": "cloudflare" }`;
- the cloudflare provider's `packages/api-runtime`.

Each capability ships a `dockerfile` implementation behind the same package export, so application code imports only the package ([ADR 0006](./0006-package-dedicated-modules.md)). The dockerfile default adds no service and targets one instance. Valkey, S3 or Chromium come later as options behind the same export.

Two shapes, as [MODULES.md](../MODULES.md) "Variants" allows:

- (a) default: one module with provider-matched variants at distinct paths, each pointing a package export at its own file through `jsonc.merge`, as `registry/modules/orm/drizzle/module.json` does for `.`.
- (b) one module per implementation with a `peers.provider` allow-list, as `db/d1` and `db/libsql`, when the implementations share no code or exclude each other.

## Consequences

- Events that reach the server entry rather than an Elysia route (WebSocket upgrade, scheduled tasks) go through the provider's `packages/api-runtime`. It gains a registration API with the first module that needs it.
- A capability without a category (realtime, scheduler, llm, observability, pdf) needs a `MODULE_CATEGORIES` change in `packages/schema`.
- Golden builds every capability on both providers.
