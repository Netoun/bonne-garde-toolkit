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

The `Dockerfile` ends in `CMD ["bun", "apps/api/src/index.ts"]`. In this repo that file is
`export default serve(app)`, with `serve` from `packages/api-runtime` — whose contents are the
Workers variant: a `{ fetch }` object behind `CloudflareAdapter`.

Bun serves a default-exported `{ fetch }` on `PORT` by itself: outside Docker,
`NODE_ENV=test PORT=5198 bun apps/api/src/index.ts` answers `GET /health` with 200. The container
itself has not been run, so this section stays until it has.

## Building the image

From the repo root, on a clean export so nothing untracked reaches the context:

```bash
S=$(mktemp -d) T=registry/modules/provider/dockerfile/template
git archive HEAD | tar -x -C "$S"
sed 's/{{SCOPE}}/@acme/g' "$T/Dockerfile" > "$S/Dockerfile"
cp "$T/.dockerignore" "$S/.dockerignore"
docker build -t bg-dockerfile "$S"
```

The `.dockerignore` has to sit at the context root, beside the `Dockerfile`.

It took two fixes to get here, neither of them where the first diagnosis put it:

- **`bun install --frozen-lockfile` failed** because `bun.lock` was stale — the `apps/cli` →
  `packages/cli` move had never been re-locked — not because of the Bun version. Once re-locked,
  1.3.11 accepts it too. The pin moved to 1.4.2 anyway, to match the version that writes the
  lockfile.
- **The SPA prerender failed with `ECONNREFUSED 127.0.0.1`.** Debian resolves `localhost` to `::1`
  first; the build stage now sets `--dns-result-order=ipv4first`, explained in the `Dockerfile`.

Status, precisely: `docker build` **completes** — install and SPA prerender both pass, observed
2026-10-30 on Bun 1.4.2. The container has **not** been run; per the section above it would serve
nothing.
