# provider/cloudflare

The runtime this toolkit was built on: Elysia on Workers, D1 for the database, R2 for media,
`wrangler` to deploy.

Nothing here is new work — it names what `apps/api` already does, so that the alternative
(`provider/dockerfile`) has something to be an alternative _to_. Installed, it is the default.

## What it settles

| Seam            | Choice                                                                  |
| --------------- | ----------------------------------------------------------------------- |
| Runtime adapter | `CloudflareAdapter` with `aot: false` (Workers forbid `new Function()`) |
| Environment     | `cloudflare:workers`, read once at module load                          |
| Database        | D1 binding `DB`, through `drizzle-orm/d1`                               |
| Object storage  | R2 binding `BUCKET`                                                     |
| Deploy          | `wrangler deploy`, config in `apps/api/wrangler.jsonc`                  |
| Dev secrets     | `.dev.vars`                                                             |

## Peers

None. `provider` is first in spec 035's topological order: it peers on nothing, and `api`, `db`,
`storage` and `deploy` peer on it.

## What the module writes

`bg add provider/cloudflare` writes the `packages/api-runtime` workspace, the package `apps/api`
imports for everything that depends on where it runs, and merges `BETTER_AUTH_SECRET` and
`RESEND_API_KEY` into `.env.example`:

- `runtimeOptions`: `{ adapter: CloudflareAdapter, aot: false }`.
- `readRuntimeEnv()`: the `cloudflare:workers` environment, `process.env` where that specifier does
  not resolve (Bun and Node).
- `serve(app)`: a `{ fetch }` object, which is what Workers want a module to default-export.

Its tests (`index.test.ts`, 6) travel with it and run from the project's root through `bun run test`.
They import `elysia`, which this repo's root does not install, so `test:scripts` skips them and golden
is where they run.
It declares `elysia`, `@cloudflare/workers-types` and `@types/node`, pinned, in the workspace
`package.json`.

## What it does not write

A provider module writes nothing under `apps/*`. The Worker's
`apps/api/wrangler.jsonc`, and the `dev` and `deploy` scripts that call `wrangler`, belong to the
`cloudflare` variant of the `api` module, which knows its own app. A project with this provider and
no `api` module has no Worker to deploy.
