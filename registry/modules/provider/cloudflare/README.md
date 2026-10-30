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

## Installing it

`bg add provider/cloudflare` writes `apps/api/wrangler.jsonc` and merges `BETTER_AUTH_SECRET` and
`RESEND_API_KEY` into `.env.example`. The `api-elysia` item also vendors an `apps/api/wrangler.jsonc`
(a minimal one), so after `bg add api-elysia` the install stops on that path, naming `api-elysia`
as its owner; `--force` replaces it and records this module as the owner. In one call the two
conflict whatever the flags. The file carries the legacy app's names (`my-app-*`) and its D1 id, to
be replaced by hand.

## Known gap

The template carries `apps/api/wrangler.jsonc` and nothing else. The runtime-specific code it
would need to own — the adapter choice, the environment read and the entry — now lives in
`packages/api-runtime` in this repo, but the module does not ship that package yet, so it cannot
claim to install a whole provider.
