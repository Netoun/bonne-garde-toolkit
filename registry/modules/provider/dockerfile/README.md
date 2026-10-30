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

Observed on 2026-10-30 (Bun 1.4.2, Docker 29.8.2 on arm64), from a clean `git archive` of commit
`284f500` with this module's template written over it, as in the recipe below.

**Runs**

- `docker build` completes: install, SPA prerender and the runtime stage. The image is 1.44 GB,
  because the runtime stage keeps the whole workspace with its dev dependencies.
- `docker compose up -d` and `docker run` reach `healthy` within 5 s. `GET /health` answers
  `{"status":"ok","timestamp":…}`.
- `GET /` answers 200 `text/html` (3,500 bytes), byte for byte the built `index.html`. Built assets
  answer 200 with their type (`/assets/entry.client-….js` as `text/javascript`, the CSS as
  `text/css`). A real browser loads the SPA to its login page with no page error and nothing in the
  console, also when it opens a deep link such as `/organizations/q/members`. The one failed
  request is the manifest icon `/android-chrome-192x192.png`, which is not in the SPA build.
- A browser navigation to a client route (`/dashboard`, `/auth/login`, `/auth/register`,
  `/auth/reset-password?token=x`) gets `index.html`. The same paths asked for as JSON keep their 404.
- Origins: with the three URLs equal to `APP_URL`, `Origin: http://localhost:5172` is echoed in
  `Access-Control-Allow-Origin` and `Origin: http://evil.test` gets no such header. `origins.ts`
  and the env schema needed no change.
- `GET /auth/get-session` answers 200 `null`, and `GET /openapi` answers 200.
- `BETTER_AUTH_SECRET` is generated on the first start (43 characters, mode 0600, owned by `bun`)
  and is the same after `docker restart`.
- `docker stop` takes 0.12 s and exits 0. Without the signal handler in `serve` it took 10.26 s
  and exited 137: Bun is PID 1, and the kernel gives PID 1 no default action for SIGTERM.

**Does not run**

- **Database.** `db.client.ts` is `drizzle-orm/d1` and the container has no `DB` binding, so
  `config.DB` is `undefined`. Nothing fails at start and `/health` never touches it; the first
  query fails with `TypeError: undefined is not an object (evaluating 'this.client.prepare')`.
  `POST /auth/sign-up/email` and `POST /auth/sign-in/email` answer 500, so no user can exist and
  there is no session. The missing piece is a libsql driver behind a `db` module matched on the
  provider; `@libsql/client` is already a dependency of `apps/api`.
- **Media.** `/v1/media/*` answers 500 `{"code":"BUCKET_NOT_CONFIGURED"}`: `r2.ts` takes an
  `R2Bucket` and there is no filesystem storage behind it.
- **Email.** `apps/api` requires `RESEND_API_KEY`, so the container exits at start without it and
  `compose.yaml` refuses to start. It was run with the placeholder `re_placeholder`. No email was
  sent, so nothing is known about Resend beyond the fact that the key is read.
- **`/auth` is claimed twice.** The SPA has pages under `/auth/*` and Better Auth's `basePath` is
  `/auth`; with one origin both answer there. The login and reset-password pages reach the SPA
  because Better Auth answers 404 and the fallback takes over. `GET /auth/verify-email?token=abc`
  from a browser answers 401 JSON from Better Auth, and the verification email links to
  `${SPA_URL}/auth/verify-email?token=…`, which is that URL. `SPA_URL = API_URL = APP_URL` is
  enough for origins but not for paths. Fixing it means another `basePath` for Better Auth or other
  SPA routes, a change to `apps/`, not to this module.
- **Rate limiting.** Better Auth logs that it "could not determine a client IP" and falls back to
  a single shared per-path bucket. Bun passes no client address to `app.fetch`, so every client
  shares one bucket per path, which matters for `/auth/sign-in/email`.
- **A different public URL needs a rebuild.** Vite bakes `VITE_API_URL` into the SPA bundle. Built
  without it, the bundle loads and the login page renders, but the organization settings route
  throws `Failed to construct 'URL': Invalid URL`; React Router reloads the page, 101 times in the
  run observed, until Better Auth answers 429. `compose.yaml` passes `APP_URL` as the build arg; for
  `docker build` it is `--build-arg VITE_API_URL=https://…`, and it must equal the `APP_URL` the
  container runs with.

Not looked at: HTTP caching headers (none are set), `HEAD` requests (not served from the built
files), and anything behind a reverse proxy.

## Building and running the image

`bg add provider/dockerfile` installs this module's files into a project made with `bg create`, but
that project is not one this image can be built from. Observed after `bg create`, `bg add
api-elysia`, `bg add provider/dockerfile`, `bun install`:

- `packages/api-runtime` holds `src/index.ts` and `src/index.test.ts` and no `package.json`, so it
  is not a workspace: `bun install` does not link it, and `typecheck` and `test` skip it (a root
  `bun test` does pick the test file up).
- Nothing imports it. `api-elysia`'s `apps/api/src/index.ts` is `export default { fetch }`, so
  `bun apps/api/src/index.ts` with `PORT` set answers `/health` and 404s on `/`: no origins, no
  generated secret, no SPA.
- The `Dockerfile` runs `bun run --filter '@scope/spa' build`, which exits 1 ("No workspace packages
  matched") when the project has no SPA workspace, so `docker build` stops there.

So "a generated project" is still built by hand here: a clean export of this repo, which has the
`@acme/api-runtime` workspace and the SPA, with the module's `template/` written over it. From the
repo root:

```bash
S=$(mktemp -d) T=registry/modules/provider/dockerfile/template
git archive HEAD | tar -x -C "$S"             # clean export: nothing untracked reaches the context
cp -R "$T"/. "$S"/                            # Dockerfile, .dockerignore, compose.yaml, api-runtime
sed 's/{{SCOPE}}/@acme/g' "$T/Dockerfile" > "$S/Dockerfile"
docker build -t bg-dockerfile "$S"
```

The `.dockerignore` has to sit at the context root, beside the `Dockerfile`; `cp -R "$T"/.` carries
it, and the two files under `packages/api-runtime/src` replace the Workers variant of that
package in the export. `index.test.ts` is one of them: left behind, the Workers one asserts
`aot === false` against code that now says `true`.

Then, with any non-empty key (it is only checked for presence):

```bash
docker run -d --name bg -p 5172:5172 -e RESEND_API_KEY=re_placeholder bg-dockerfile
curl -s localhost:5172/health
docker rm -f -v bg                    # -v: `VOLUME /data` made an anonymous volume

# or, from the export: compose builds the image and needs the key in its environment
cd "$S" && RESEND_API_KEY=re_placeholder docker compose up -d
RESEND_API_KEY=re_placeholder docker compose ps
RESEND_API_KEY=re_placeholder docker compose down -v --rmi local
```

It took two fixes to get the image to build, neither of them where the first diagnosis put it:

- **`bun install --frozen-lockfile` failed** because `bun.lock` was stale — the `apps/cli` →
  `packages/cli` move had never been re-locked — not because of the Bun version. Once re-locked,
  1.3.11 accepts it too. The pin moved to 1.4.2 anyway, to match the version that writes the
  lockfile.
- **The SPA prerender failed with `ECONNREFUSED 127.0.0.1`.** Debian resolves `localhost` to `::1`
  first; the build stage now sets `--dns-result-order=ipv4first`, explained in the `Dockerfile`.
