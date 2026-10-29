# provider/dockerfile

One container. The Bun API listens on `PORT` and serves the built SPA from the same origin; a
single `/data` volume holds the database, media and generated secrets. No Cloudflare account, no
external service.

Harvested from `bonne-garde-keeper`, which shipped this runtime and whose design document
(`2026-10-18-labo-49-standalone-docker`) is the source for the decisions below.

## What it settles

| Seam            | Choice                                                                   |
| --------------- | ------------------------------------------------------------------------ |
| Runtime adapter | Elysia's default Bun adapter, listening on `PORT`; `aot` left on         |
| Environment     | `process.env`                                                            |
| Database        | SQLite file under `DATA_DIR`, through `drizzle-orm/libsql`               |
| Object storage  | Local filesystem under `DATA_DIR`                                        |
| Origins         | One `APP_URL` rather than the `SPA_URL` / `SSR_URL` / `API_URL` triple   |
| Deploy          | `docker build` and `compose.yaml`                                        |
| Secrets         | `BETTER_AUTH_SECRET` generated into `DATA_DIR` on first start when unset |

## Two decisions taken from keeper rather than invented

**The build stage runs on `node:24-slim` with Bun copied in.** React Router prerenders the SPA
through Vite preview, which needs a real Node; Bun alone cannot run that step. This is the kind of
thing that costs an afternoon to rediscover.

**`BETTER_AUTH_SECRET` is generated, not required.** Keeper's reasoning: a volume and a port should
be enough for `docker run`, and failing at startup on a missing secret breaks that. It is written
once under `DATA_DIR` with an exclusive create so two simultaneous starts cannot produce two
secrets.

## Deliberately left out

Keeper's container also carries OIDC provider configuration, roles, invitations, SMTP, backups with
a cron schedule, and a control socket to work around PGlite being single-process. All of that is
keeper's _product_, not its runtime, so none of it belongs in a provider module. Keeper is also on
PGlite/PostgreSQL, which it chose long before this change — it is not a reason to move this
toolkit's Drizzle dialect off sqlite.

## This module does not run yet

The `Dockerfile` ends in `CMD ["bun", "apps/api/src/index.ts"]`, and in this repo that file is
`export default { fetch }` behind `CloudflareAdapter`. It never listens on a port, so the
container starts and serves nothing.

Making it run needs an `api` module whose `dockerfile` variant produces a listening entrypoint —
and that entrypoint lives in `apps/api/src`, which spec 035's package-dedicated seam rule forbids
a module to write. So the order is: lift the API entrypoint and the runtime-env read into a
package, then this module becomes installable.

## The build fails today, and the reason is not in this module

`docker build` was run against this template. It gets through both base stages and dies on
`bun install --frozen-lockfile`:

```
bun install v1.3.11
error: lockfile had changes, but lockfile is frozen
```

The image pins Bun from the root `package.json` `packageManager`, which says `bun@1.3.11`, while
`bun.lock` is written by Bun 1.4.2. Bun 1.3.11 resolves that lockfile differently, so a frozen
install refuses it. This is the same version mismatch that hid the missing `exports` subpaths
earlier (`bcf680e`'s predecessor `7e99cc2`) — there it only made a bug invisible locally; here it
stops the build outright.

So the first fix is one line in the root `package.json`: `packageManager` to `bun@1.4.2`, which
also aligns CI, since the workflow takes its Bun version from that same field. It was not changed
in the commit that added this module because it moves the whole repo's toolchain and deserves its
own verified change.

Status, precisely: the template's stage layout is sound and harvested from a working image; the
build has **not** completed; the container has **not** been observed serving traffic.
