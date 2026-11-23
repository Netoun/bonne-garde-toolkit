# provider/cloudflare

The runtime this toolkit was built on: Elysia on Workers, deployed with `wrangler`. The bindings the
modules read, `DB` and `BUCKET`, are theirs: [`db/d1`](../../db/d1/README.md) declares `DB` and
[`storage/r2`](../../storage/r2/README.md) declares `BUCKET`. This provider only hands them over, through
`readRuntimeEnv()`.

Nothing here is new work — it names what `apps/api` already does, so that the alternative
(`provider/dockerfile`) has something to be an alternative _to_. Installed, it is the default.

## What it settles

| Seam            | Choice                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| Runtime adapter | `CloudflareAdapter` with `aot: false` (Workers forbid `new Function()`) |
| Environment     | `cloudflare:workers`, read once at module load; bindings are in it      |
| Deploy          | `wrangler deploy`, config in the Worker's `wrangler.jsonc`              |
| Dev secrets     | `.dev.vars`                                                             |

## Peers

None. `provider` is first in the topological order of categories: it peers on nothing, and `api`, `db`,
`storage` and `deploy` peer on it.

## What the module writes

`bunx bonne-garde add provider/cloudflare` writes the `packages/api-runtime` workspace, the package `apps/api`
imports for everything that depends on where it runs:

- `runtimeOptions`: `{ adapter: CloudflareAdapter, aot: false }`.
- `readRuntimeEnv()`: the `cloudflare:workers` environment, `process.env` where that specifier does
  not resolve (Node, Bun).
- `clientIpHeaders`: `["cf-connecting-ip"]`. Cloudflare's edge sets it to the client's address on
  every request that reaches a Worker and replaces a value the client sent; `x-forwarded-for`, which
  Better Auth reads unless told otherwise, is not set on Workers.
- `serve(app)`: a `{ fetch }` object, which is what Workers want a module to default-export.
- `wrapRequests(wrapper)`: registers a `RequestWrapper`, `(request, env, ctx, next) => Promise<Response>`,
  that `serve` runs around every request, the first registered outermost; it returns what removes it.
  `env` and `ctx` are the Worker's, `ctx` typed as `RequestContext` (`waitUntil`), the same on both
  providers. A module that must see the request before the app does registers at import, so
  `apps/api/src/index.ts` stays as it is: `observability/sentry` opens and flushes its client there.

Its tests (`index.test.ts`, 11) travel with it and run from the project's root through `vp run test`.
They import `elysia`, which this repo's root does not install, so `test:scripts` skips them and golden
is where they run.
It declares `elysia`, `@cloudflare/workers-types` and `@types/node`, pinned, in the workspace
`package.json`.

It declares no env key: a key belongs to the module that reads it, and nothing here reads one.
`RESEND_API_KEY` is the `email` module's.

## What it does not write

A provider module writes nothing under an app's directory. The Worker's `wrangler.jsonc`, and the
`dev` and `deploy` scripts that call `wrangler`, belong to the `cloudflare` variant of the `api`
module, which knows its own app. A project with this provider and no `api` module has no Worker to
deploy.
