# provider/dockerfile

One container. The Bun API listens on `PORT` and serves the built SPA from the same origin; a
single `/data` volume is meant to hold the database, media and generated secrets. No Cloudflare
account. Today the container runs and serves the API shell and the SPA, but it has **no database
and no object storage**, so sign-up, sign-in and media do not work — see
[What runs, and what does not](#what-runs-and-what-does-not).

Harvested from `bonne-garde-keeper`, which shipped this runtime and whose design document
(`2026-10-18-labo-49-standalone-docker`) is the source for the decisions below.

## What it settles

| Seam            | Choice                                                                   | State                 |
| --------------- | ------------------------------------------------------------------------ | --------------------- |
| Runtime adapter | Elysia's default Bun adapter, listening on `PORT`; `aot` left on         | done                  |
| Environment     | `process.env`, completed for one origin                                  | done                  |
| Origins         | One `APP_URL`, which fills the `SPA_URL` / `SSR_URL` / `API_URL` triple  | done, with one caveat |
| Secrets         | `BETTER_AUTH_SECRET` generated into `DATA_DIR` on first start when unset | done                  |
| Deploy          | `docker build` and `compose.yaml`                                        | done                  |
| Database        | SQLite file under `DATA_DIR`, through `drizzle-orm/libsql`               | **not done**          |
| Object storage  | Local filesystem under `DATA_DIR`                                        | **not done**          |

The caveat on origins is in the list of what does not work: the URLs agree, the paths do not.

## What the module writes

The module owns the `packages/api-runtime` workspace whole: `package.json` (the `@scope/api-runtime`
name, an `exports` map and the `typecheck` and `test` scripts; `elysia` is merged in from the
variant), `tsconfig.json`, `src/index.ts` and `src/index.test.ts`. It is what `provider/cloudflare`
writes at the same paths, so swapping providers swaps this package and leaves `apps/api` alone.
`src/index.ts` exports the same three names `apps/api` imports, so `app.ts` and the entry stay as
they are:

- `runtimeOptions`: `{ aot: true }`. Elysia picks its Bun adapter itself.
- `readRuntimeEnv(source = process.env)`: fills `SPA_URL`, `SSR_URL` and `API_URL` from `APP_URL`,
  `R2_PUBLIC_URL` from `<APP_URL>/v1/media/file`, and `BETTER_AUTH_SECRET` from
  `DATA_DIR/secrets/better-auth-secret`. It does not invent `RESEND_API_KEY`.
- `serve(app, { spaDir, port })`: returns `{ port, fetch }`, which Bun serves by itself when
  `apps/api/src/index.ts` is the entry. Nothing calls `.listen()`: a default export that has `fetch`
  plus a `listen()` starts two servers on one port. A file under `apps/spa/build/client` is served
  as is, anything else goes to the app, and a `GET` the app answers 404 gets `index.html` when the
  client accepts `text/html`. It also exits on SIGINT and SIGTERM, see below.

Its tests (`index.test.ts`, 29) travel with it. In a project, `packages/api-runtime` is a workspace
and `bun run test` runs them; in this repo `registry/` is not one, so they run through
`bun run test:scripts`.

## Two decisions taken from keeper rather than invented

**The build stage runs on `node:24-slim` with Bun copied in.** React Router prerenders the SPA
through Vite preview, which needs a real Node; Bun alone cannot run that step. This is the kind of
thing that costs an afternoon to rediscover.

**`BETTER_AUTH_SECRET` is generated, not required.** Keeper's reasoning: a volume and a port should
be enough for `docker run`, and failing at startup on a missing secret breaks that. It is written
once under `DATA_DIR`, to a temporary file that is hard-linked into place, so two simultaneous
starts cannot produce two secrets and a reader never sees an empty file. `RESEND_API_KEY` is not
treated the same way: `apps/api` requires it and nothing here can stand in for an email provider,
so a volume and a port are not enough for this module, a key is needed too.

## Deliberately left out

Keeper's container also carries OIDC provider configuration, roles, invitations, SMTP, backups with
a cron schedule, and a control socket to work around PGlite being single-process. All of that is
keeper's _product_, not its runtime, so none of it belongs in a provider module. Keeper is also on
PGlite/PostgreSQL, which it chose long before this change — it is not a reason to move this
toolkit's Drizzle dialect off sqlite.

## What runs, and what does not

Observed on 2026-10-30 (Bun 1.4.2, Docker 29.8.2 on arm64), on the project golden makes for its
`dockerfile` configuration: `provider/dockerfile`, `tooling/vite-plus`, `config/branding`,
`ui/shadcn`, `api/elysia` and `web/spa`. `docker build` completes, and the container, run with a
volume on `/data` and its port published on `127.0.0.1`, answers:

- `GET /health`: 200 `application/json`, `{"status":"ok","timestamp":…}`.
- `GET /`: 200 `text/html`, the `index.html` of the `web/spa` build. Its route manifest lists the
  `root` route and the index route `routes/home`.
- A hashed asset of that page, `/assets/manifest-<hash>.js`: 200 `text/javascript`.
- A path no file matches, `/golden/unknown-client-route`, asked for with `Accept: text/html`: 200,
  and the same `index.html` as `GET /`.

`bun run golden` makes these four requests after `docker build` and `docker run`. It fails when one
answers another status or media type, or when the client route answers something other than
`GET /`. It skips them, and says so, when `docker` is not on PATH or its daemon does not answer
`docker info`, unless `GOLDEN_REQUIRE_DOCKER` is set: CI sets it, and then that is a failed run.

The `api/elysia` shell wires no database, authentication, object storage or email, so the container
has none of them.

## Building and running the image

A project made with `bg create` builds this image once it has the modules the container runs. It
needs no SPA: the `Dockerfile` builds with the root `build` script, which builds whichever apps the
project has, and `serve` answers 404 for `GET /` when `apps/spa/build/client` is missing.

```bash
bunx bg create my-app --yes --no-git && cd my-app
bunx bg add config/branding provider/dockerfile api/elysia     # `add` runs `bun install`: the image needs bun.lock
docker build -t my-app .
docker run -d --name my-app -p 5172:5172 my-app
curl -s localhost:5172/health
docker rm -f -v my-app                # -v: `VOLUME /data` made an anonymous volume
```

Observed on 2026-10-30 (Bun 1.4.2, Docker 29.8.2 on arm64) on a project made that way with
`provider/dockerfile`, `tooling/vite-plus`, `config/branding` and `api/elysia`, which was golden's
`dockerfile` configuration before it gained `ui/shadcn` and `web/spa`: `docker build` completes, the
container is `healthy`, `GET /health` answers `{"status":"ok",…}`, `GET /openapi` answers 200, and
`Origin: http://localhost:5172` is echoed in `Access-Control-Allow-Origin`. `docker stop` exits 0 in
under a second. Before this module wrote the `package.json` of `packages/api-runtime` and the
`Dockerfile` stopped naming the SPA, `bun run --filter '@scope/spa' build` failed with "No workspace
packages matched" on such a project.

`compose.yaml` still refuses to start without `RESEND_API_KEY`, which the API shell no longer reads:
the `email` module will own it.

Two fixes were needed to get the image to build at all, neither of them where the first diagnosis put it:

- **`bun install --frozen-lockfile` failed** because `bun.lock` was stale — the `apps/cli` →
  `packages/cli` move had never been re-locked — not because of the Bun version. Once re-locked,
  1.3.11 accepts it too. The pin moved to 1.4.2 anyway, to match the version that writes the
  lockfile.
- **The SPA prerender failed with `ECONNREFUSED 127.0.0.1`.** Debian resolves `localhost` to `::1`
  first; the build stage now sets `--dns-result-order=ipv4first`, explained in the `Dockerfile`.
