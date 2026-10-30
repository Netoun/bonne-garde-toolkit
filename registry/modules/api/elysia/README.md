# api/elysia

The API shell: an Elysia app with CORS, an OpenAPI page and a `/health` route, an env config, and the
Eden types the fronts import. It runs on whichever provider is installed, and has no database, no
auth, no object storage and no email: those arrive as modules of their own.

## Peers and variants

| Peer       | Allow-list | Why                                                                        |
| ---------- | ---------- | -------------------------------------------------------------------------- |
| `provider` | any        | `apps/api` imports `{{SCOPE}}/api-runtime`, which the provider module owns |
| `config`   | `branding` | `app.ts` reads `branding.displayName` from `{{SCOPE}}/config`              |

One variant per provider, selected on the installed one. They list the same files, except that the
`cloudflare` variant also copies `apps/api/wrangler.jsonc`, and they differ in what they add to the
vendored `apps/api/package.json` with `scripts.merge` (spec 060):

| Variant      | Extra file                | `scripts.merge` on `apps/api/package.json`                     | Extra dependency |
| ------------ | ------------------------- | -------------------------------------------------------------- | ---------------- |
| `cloudflare` | `apps/api/wrangler.jsonc` | `dev`: `wrangler dev --port 5172`, `deploy`: `wrangler deploy` | `wrangler` (dev) |
| `dockerfile` | none                      | `dev`: `bun --watch src/index.ts`                              | none             |

The package.json the module vendors carries no `dev` and no `deploy`: a patch is computed on the
template, so a script already in it would be reported `skipped` on the first install. Both variants
depend on `{{SCOPE}}/api-runtime` and `{{SCOPE}}/config` as `workspace:*` and pin `elysia` to the
version the provider does, so there is one copy of it.

## What it writes

Everything under `apps/api`, which is its home (035):

- `src/index.ts`: the thin entry, `export default serve(app)` over `{{SCOPE}}/api-runtime`.
- `src/app.ts`: `export const app = new Elysia(runtimeOptions)` with `cors`, `openapi` and
  `GET /health`, and `export type App`.
- `src/lib/{app.config,env,origins,logger,eden,slug}.ts`, with the tests of the first three.
- `src/modules/test/{health,openapi}.test.ts`, `src/app.test.ts`, `src/exports.test.ts`,
  `src/test-setup.ts` and `bunfig.toml`, which preloads it so `NODE_ENV` is `test`.
- `package.json`, `tsconfig.json`, `tsconfig.test.json`.

`bun test` in `apps/api` runs seven test files, 33 tests: the six of the legacy shell, and
`exports.test.ts`, which is new. They import `{{SCOPE}}/…` packages that exist
only in a project, so `test:scripts` skips this directory and golden is where they run.

## What the fronts import

`package.json` `exports` is `.`, `./app` and `./lib/*` (`./src/lib/*.ts`). A front reaches the API
through `type App` from `{{SCOPE}}/api/app` and the helpers of `{{SCOPE}}/api/lib/eden`. The module
imports itself the same way (`{{SCOPE}}/api/lib/origins`), so a `./lib/*` entry missing from `exports`
breaks the API's own typecheck and tests, which golden runs. `exports.test.ts` imports `./app` and
`./lib/eden` by the package name, so golden catches a subpath missing from `exports` before the `web`
modules import them, and the contract test pins the same two.

## Where a module plugs in

`app.ts` has one marked place, between the last `.use()` and the routes, where a `ts.elysiaUse`
patch (spec 060) adds `.use(<module>)` for `db`, `auth` and `storage` without reformatting the
chain. The patch is built; the contract test pins the name `app`, the `new Elysia(runtimeOptions)`
start and the place of the comment. No module uses it yet: `apps/api` has to depend on the package
whose module is imported, no patch can write that dependency (060: `jsonc.merge` refuses
`{{SCOPE}}`), and `orm/drizzle` explains what that leaves open.

## Placeholders to replace

The cloudflare variant's `wrangler.jsonc` keeps the legacy app's names (`my-app-api`,
`api.my-app.com`, the `*.my-app.com` fronts). `bg add` renders `{{SCOPE}}` and nothing else, so they
are replaced by hand.

## Typechecking

- `tsconfig.json` sets `noUncheckedIndexedAccess: false`, which the project's base turns on: the
  config code was written without it (`properties[key]` in `app.config.ts`).
- `types` is `["bun"]` only. The `cloudflare` provider's `src/index.ts` carries its own
  `/// <reference types="@cloudflare/workers-types" />`, so that `cloudflare:workers` resolves in
  this app's program without the app naming a provider's types.

## Left out

`lib/email.ts` (email), `lib/r2.ts` and `modules/media` (storage), `lib/crypto/password.ts`,
`modules/auth` and the Better Auth schema (auth), `modules/db`, the `DB` binding in `env.ts` and the
D1 and R2 entries of `wrangler.jsonc` (db, orm, storage). `app.config.ts` and `env.ts` lose the keys
those modules own (`R2_PUBLIC_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `DB`, `BUCKET`): the shell
requires none, and each module validates its own.
