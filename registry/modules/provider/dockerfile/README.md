# provider/dockerfile

One container. The API, on Node, listens on `PORT` and serves the built SPA from the same origin; a
single `/data` volume is meant to hold the database, media and generated secrets. No Cloudflare
account. Today the container runs and serves the API shell and the SPA, but it has **no database
and no object storage**, so sign-up, sign-in and media do not work — see
[What runs, and what does not](#what-runs-and-what-does-not).

It peers on no package manager: the image installs the project with the one `package.json` pins
(`packageManager`, the `pm` module's) — `npm install --global` of that exact version, then its `install
--frozen-lockfile` and the root `build` — and runs the API on Node in both cases, the TypeScript entry
loaded through `tsx` (`node --import tsx packages/api-runtime/src/main.ts`, so Node is PID 1). That entry
starts the API when the project has one (`apps/api/src/index.ts`, which serves the SPA beside it), and
serves the SPA alone otherwise: `bg create --apps spa --provider dockerfile` is a container too.

Harvested from `bonne-garde-keeper`, which shipped this runtime and whose design document
(`2026-10-18-labo-49-standalone-docker`) is the source for the decisions below.

## What it settles

| Seam            | Choice                                                                   | State                 |
| --------------- | ------------------------------------------------------------------------ | --------------------- |
| Runtime adapter | Elysia's web-standard adapter behind srvx, listening on `PORT`; `aot` on | done                  |
| Environment     | `process.env`, completed for one origin                                  | done                  |
| Origins         | One `APP_URL`, which fills the `SPA_URL` / `SSR_URL` / `API_URL` triple  | done, with one caveat |
| Secrets         | `BETTER_AUTH_SECRET` generated into `DATA_DIR` on first start when unset | done, `auth` reads it |
| Deploy          | `docker build` and `compose.yaml`                                        | done                  |
| Database        | SQLite file under `DATA_DIR`, through `drizzle-orm/libsql`               | **not done**          |
| Object storage  | Local filesystem under `DATA_DIR`                                        | **not done**          |

The caveat on origins is in the list of what does not work: the URLs agree, the paths do not.

## What the module writes

The module owns the `packages/api-runtime` workspace whole: `package.json` (the `@scope/api-runtime`
name, an `exports` map and the `typecheck` and `test` scripts; `elysia` is merged in from the
variant), `tsconfig.json`, `src/index.ts`, `src/index.test.ts` and `src/main.ts`, the container's entry.
`src/index.ts` is what `provider/cloudflare`
writes at the same paths, so swapping providers swaps this package and leaves `apps/api` alone.
`src/index.ts` exports the same four names `apps/api` and the modules import, so `app.ts` and the
entry stay as they are:

- `runtimeOptions`: `{ aot: true }`. Elysia picks its adapter by the runtime: web-standard on Node.
- `readRuntimeEnv(source = process.env)`: fills `SPA_URL`, `SSR_URL` and `API_URL` from `APP_URL`, and
  `BETTER_AUTH_SECRET` from `DATA_DIR/secrets/better-auth-secret`. It invents no other key: a key
  belongs to the module whose code reads it (035), so `RESEND_API_KEY` is the `email` module's and
  `R2_PUBLIC_URL` is `storage/r2`'s, which is Cloudflare-only and has no variant for this provider.
- `clientIpHeaders`: `["x-client-ip"]`, the header `serve` fills with the client's address. See
  [The client's address](#the-clients-address-and-a-reverse-proxy).
- `serve(app, { spaDir, port, trustedProxyHeader })`: starts [srvx](https://srvx.h3.dev), which runs the
  same on Node and on Bun, and resolves with the server once it listens. It returns a promise, which
  has no `fetch`, so a runtime that serves a default-exported `{ fetch }` by itself starts no second one.
  What it answers is `handler(app, options)`: a file under `apps/spa/build/client` is served as is with
  its content type, anything else goes to the app, and a `GET` the app answers 404 gets `index.html`
  when the client accepts `text/html`. It also exits on SIGINT and SIGTERM, see below. `listenPort` is
  the port: the one given, `PORT`, or 5172.

Its tests (`index.test.ts`, 36) travel with it. In a project, `packages/api-runtime` is a workspace
and `vp test` runs them; in this repo `registry/` is not one, so they run through
`bun run test:scripts`.

## Two decisions taken from keeper rather than invented

**The build stage runs on `node:24-slim`.** React Router prerenders the SPA through Vite preview,
which needs a real Node; Bun alone cannot run that step. This is the kind of
thing that costs an afternoon to rediscover.

**`BETTER_AUTH_SECRET` is generated, not required.** The key is the `auth` module's: it declares it in
`.env.example` and reads it through `readRuntimeEnv()`, so on this provider it finds the generated
value and an operator's own wins. The provider declares no env entry for it, since a key belongs to the
module that reads it (035). Keeper's reasoning: a volume and a port should
be enough for `docker run`, and failing at startup on a missing secret breaks that. It is written
once under `DATA_DIR`, to a temporary file that is hard-linked into place, so two simultaneous
starts cannot produce two secrets and a reader never sees an empty file. `RESEND_API_KEY` is not
treated the same way, and it is not this module's: it is the `email` module's key, which that module
declares and reads, and nothing here can stand in for an email provider. The API boots without it, and
the first email asked for fails naming the key; `compose.yaml` forwards the project's `.env`, so the key
reaches the container when the file has it (see [Compose and the project's `.env`](#compose-and-the-projects-env)).

## Compose and the project's `.env`

`compose.yaml` names only what the provider owns: `APP_URL`, `TRUSTED_PROXY_HEADER` and the build argument
`VITE_API_URL`, which bakes the API's origin into the SPA bundle. Every other key reaches the container
through `env_file`, which forwards the project's `.env` whole:

```yaml
env_file:
  - path: .env
    required: false
```

A module declares its keys in the root `.env.example` (`bg add` merges them there), so the flow is
`cp .env.example .env`, fill it, `docker compose up`, with nothing to add to `compose.yaml` when a module
is installed. `BETTER_AUTH_SECRET=` left blank in `.env` counts as unset, and the runtime generates the
secret into `DATA_DIR/secrets` on first start; a value an operator sets wins.

- **Docker Compose 2.24 or later.** `required: false` on an `env_file` entry (the long form) arrived in
  2.24.0; before it the file had to exist, and a project with no `.env` failed to start. Observed with
  Compose v5.5.0: `docker compose config` accepts the file with and without a `.env`.
- **`environment` wins over `env_file`**, so `APP_URL` and `TRUSTED_PROXY_HEADER` keep their defaults, and a
  value in `.env` for either of them is the one Compose interpolates, since it reads `.env` for that too.
- **A key exported only in the host's shell no longer reaches the container.** The old file named
  `RESEND_API_KEY` with `${RESEND_API_KEY:-}`, which Compose filled from the shell; `env_file` reads the
  file only. Put the key in `.env`, or pass it with `docker compose run -e` / `docker run -e`.
- **Everything in `.env` is forwarded**, including keys the container never reads. Keep `.env` out of git
  (the template's `.gitignore` does) and out of the image (the `.dockerignore` does).

## The client's address and a reverse proxy

A rate limit has to tell clients apart, and the container publishes its port, so the one header that
cannot be trusted is `x-forwarded-for`: any client can send it, and a limit keyed on it is a limit each
client sets for itself. `serve` therefore stamps `x-client-ip` on every request, with the address of the
socket (`server.requestIP`), after dropping whatever a client sent under that name. `clientIpHeaders`
names it, and a module that rate-limits reads that, not a header of its own.

Behind a reverse proxy the socket is the proxy, and every client would share one address. If a proxy
you control sits in front and **overwrites** a header with the client's address, set
`TRUSTED_PROXY_HEADER` to its name (`x-forwarded-for`, `x-real-ip`): `serve` then takes that header's
last entry, the one your proxy appended, and falls back to the socket when it is absent. Do not set it
while the port is published to clients directly: it hands the choice of address back to them. Traefik,
Caddy and nginx all set `x-forwarded-for`; none of them is in this module's `compose.yaml`, which
publishes the port.

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
  `root` route and the index route `features/home/pages/home-page`.
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
bg create my-app --apps api --provider dockerfile --yes --no-git && cd my-app   # --pm bun or pnpm
# `create` installs: the image needs the lockfile of the package manager package.json pins
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

`compose.yaml` does not refuse to start without a module's key: the API shell reads none, and each module
owns its own (see the next section).

Two fixes were needed to get the image to build at all, neither of them where the first diagnosis put it:

- **`bun install --frozen-lockfile` failed** because `bun.lock` was stale — the `apps/cli` →
  `packages/cli` move had never been re-locked — not because of the Bun version. Once re-locked,
  1.3.11 accepts it too. The pin moved to 1.4.2 anyway, to match the version that writes the
  lockfile.
- **The SPA prerender failed with `ECONNREFUSED 127.0.0.1`.** Debian resolves `localhost` to `::1`
  first; the build stage now sets `--dns-result-order=ipv4first`, explained in the `Dockerfile`.
