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

## Known gap

The template carries `apps/api/wrangler.jsonc` and nothing else. The runtime-specific code it
would need to own — the adapter choice in `apps/api/src/app.ts` and the environment read in
`apps/api/src/lib/runtime-env.ts` — sits inside an app's `src`, which spec 035's
package-dedicated seam rule forbids a module to write. Those move into a package before this
module can claim to install a whole provider.
