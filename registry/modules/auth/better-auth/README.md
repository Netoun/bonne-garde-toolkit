# auth/better-auth

Session authentication over the project's database: email and password, email verification, password
reset, and organizations. It is the legacy `apps/api/src/modules/auth` extracted into its own package,
`packages/auth`, which `apps/api` mounts.

```bash
bunx bonne-garde add provider/cloudflare config/branding api/elysia db/d1 orm/drizzle auth/better-auth
```

## Peers and variant

| Peer       | Allow-list     | Why                                                                                            |
| ---------- | -------------- | ---------------------------------------------------------------------------------------------- |
| `provider` | any            | `readRuntimeEnv` from `{{SCOPE}}/api-runtime` reads the secret; the provider owns that package |
| `api`      | any            | the CORS allow-list, the logger and the config of `{{SCOPE}}/api/lib/*`                        |
| `db`       | `d1`, `libsql` | `readD1()` from `{{SCOPE}}/db/d1`, or `readLibsql()` from `{{SCOPE}}/db/libsql`                |
| `orm`      | `drizzle`      | `createDB` from `{{SCOPE}}/db` and the test database from `{{SCOPE}}/db/testing`               |

Two variants, picked by the installed `db`: `d1` (Cloudflare) and `libsql` (the `dockerfile` provider, see
[Dockerfile and libsql](#dockerfile-and-libsql)). Both write the same `packages/auth`; only the files bound to the
database differ.

`bunx bonne-garde add better-auth` in a project with no `orm` fails with
`auth/better-auth needs a module in category orm (drizzle) and none is installed`, before anything is
written. Golden checks that with the packed CLI, and the contract test checks the planner.

**It has no `withOrg` option.** 035's example declares one. A variant selects files by the installed
peers only (`match` takes categories), and `--set` is refused, so an option would resolve to its
default, be recorded, and change nothing. The schema is generator output with the organization,
member and invitation tables in it, and `storage`'s `medias` table has foreign keys onto
`organization`. The module ships organizations always.

## What it writes

Everything in `packages/auth`, from explicit paths:

| File                                | What it is                                                                                                                      |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `package.json`                      | `{{SCOPE}}/auth`: the `.`, `./client`, `./permissions`, `./schema` and `./testing` exports, the scripts below                   |
| `src/auth.config.ts`                | `createAuth(options)`: the Better Auth instance, with no environment read and nothing built at import                           |
| `src/auth.module.ts`                | `authModule` (the handler mounted on the app) and `authMacro` (`{ auth: true }` on a route)                                     |
| `src/permissions.ts`                | `ac`, `roles` and `OrganizationRole`: the organization's access control, safe to import from a front                            |
| `src/permission.macro.ts`           | the `{ permission: { ... } }` macro both modules mount                                                                          |
| `src/schema.ts`                     | the Drizzle tables and relations, **generator output** (see below)                                                              |
| `src/env.ts`                        | `resolveAuthEnv`: `BETTER_AUTH_SECRET`, read from `readRuntimeEnv()`                                                            |
| `src/mailer.ts`                     | `AuthMailer`, and the `mailer` an `email` module replaces                                                                       |
| `src/password.ts`                   | scrypt `hashPassword` / `verifyPassword`, shared with the seed                                                                  |
| `src/seed.ts`                       | `db:seed`: `seedAdmin` (the admin, once), a SQL builder that is tested, and a thin `wrangler` runner; it deletes nothing        |
| `src/client.ts`, `src/base-path.ts` | what a front imports: `type Auth` and `AUTH_BASE_PATH`, with no server code                                                     |
| `src/auth.cli.ts`                   | the entry `auth:generate` loads                                                                                                 |
| `src/testing.ts`                    | `createTestAuth(overrides?, tables?)`: an instance over real in-memory SQLite, for this package's tests and others' (see below) |
| `src/*.test.ts`                     | the tests that travel, and the new ones, all against real SQLite: no mock of Drizzle or `fetch`                                 |

Dependencies are exact: `better-auth` and `@better-auth/drizzle-adapter` at the same release (a
contract test pins that, and `auth`, the CLI the scripts run, a devDependency at that release too), `drizzle-orm`, `elysia`, and the project's
`api`, `api-runtime` and `db` as workspaces. `api` imports `auth` to mount it and `auth` imports `api`'s
`lib/*`; `db`'s barrel re-exports `auth`'s tables. bun and pnpm accept those workspace cycles (see Wiring).

## `createTestAuth` for another module's tests

`createTestAuth(overrides?, tables?)` from `{{SCOPE}}/auth/testing` is the one place a test learns how to
sign a user in: it signs up through the handler, opens the link of the verification email it kept, and
signs in, which is `signIn(email)`, the cookie of that session. A module whose tables point at auth's
passes them as the second argument, `createTestAuth({}, { medias })`, and they are created beside auth's in
the same in-memory database, which comes back typed with both as `db`. `storage/r2`'s `createTestStorage`
is built that way, so it repeats none of the flow. Each instance reads its own client address, so the
rate limit of one test is never spent by another.

## The schema is pure generator output

`vp run auth:generate` (in `packages/auth`) runs the Better Auth CLI, pinned to the version the package
depends on, on `src/auth.cli.ts`, writes `src/schema.ts`, and formats it. It runs on Node through the
CLI's shebang, on purpose: run by Bun the generator drops every `created_at` default without an
error (it tests `defaultValue.toString()` for `new Date()`, and Bun prints that function differently).
A test pins the defaults. The legacy file keeps one hand edit, `organization.slug`'s `uniqueIndex`; this
module does not, so the file has `.unique()` there, as the generator writes it. Golden runs
`auth:generate` in the project it builds and fails unless the file comes back byte for byte.

`vp run auth:secret` prints a secret for `BETTER_AUTH_SECRET`.

## Environment

The module declares `BETTER_AUTH_SECRET` (`required`) and reads it through `readRuntimeEnv()`, never
through the shell's `app.config.ts`. A key belongs to the module that reads it, so neither
provider declares it.

| Provider     | Where the secret comes from                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------- |
| `cloudflare` | `.dev.vars` in `apps/api` for `wrangler dev`, `wrangler secret put BETTER_AUTH_SECRET` when deployed |
| `dockerfile` | the container's environment, or generated into `DATA_DIR/secrets` on first start when unset          |

The dockerfile runtime's generation is container behaviour inside its `readRuntimeEnv`; auth finds the
value there and an operator's own wins. Under `NODE_ENV=test` a missing secret gets a fixture. Anywhere
else a missing one fails the first request that needs auth, naming the key.

`RESEND_API_KEY` is not auth's: it is the `email` module's.

## Email

Auth does not send email. It asks an `AuthMailer` (`sendVerificationEmail`, `sendPasswordReset`), and
the `mailer` exported by `src/mailer.ts` is what `auth.module.ts` hands it. With no `email` module that
is `unconfiguredMailer`: it sends nothing and logs a warning that names the user and never the link,
which carries a one-time token. `requireEmailVerification` stays on, so **a user who signs up in a
project with no email module cannot sign in** until one is wired in; the seeded admin is verified.

The `email` module replaces the `mailer` value with an adapter over its own package, through the
intention it ships: auth owns the interface, never the reverse.

## Where it is served

Under `/api/auth`, Better Auth's own default, and not the legacy `/auth`. The SPA has pages at
`/auth/login`, `/auth/register`, `/auth/forgot-password`, `/auth/reset-password` and
`/auth/verify-email`, and the links in the emails open them. With the `dockerfile` provider the SPA and
the API share an origin, and an API at `/auth` answered `GET /auth/verify-email?token=…` with JSON
(401) instead of the page. The API is what moves, because the pages are what users and emails already
point at, and the move costs the fronts one line: `createAuthClient({ baseURL, basePath: AUTH_BASE_PATH })`
from `{{SCOPE}}/auth/client`, or no `basePath` at all, since it is the client's default too. A request
the API does not know, `/auth/*` included, is a 404, which is what the dockerfile runtime answers with
the SPA's `index.html` for a browser navigation. `auth.flow.test.ts` pins both halves.

The legacy `apps/spa` still talks to the legacy `apps/api` at `/auth`; the front's `lib/auth.ts` moves
with the feature items and takes `AUTH_BASE_PATH` then.

## Dockerfile and libsql

```bash
bunx bonne-garde create my-app --provider dockerfile --apps api --features db
bunx bonne-garde add auth/better-auth
```

The `libsql` variant reads the database through `readLibsql()` and `createDB` of `{{SCOPE}}/db`, over the SQLite
file under `DATA_DIR`. The schema, `auth.config.ts` and the SQLite dialect are the D1 variant's, unchanged. A module has one
`template/` tree and a variant cannot change a file's content, so the files bound to the database sit at paths of their
own, as `orm/drizzle`'s `libsql-*.ts` do, and the variant points the package at them (`jsonc.merge` on `exports`,
`scripts.merge` on the scripts; the variant vendors no `package.json`, the planner generates it):

| D1 variant                                                            | libsql variant                                                                       |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `auth.module.ts` (`readD1`)                                           | `libsql-auth.module.ts` (`readLibsql`), one instance per process                     |
| `auth.cli.ts` (`bindD1`)                                              | `libsql-auth.cli.ts`: an in-memory libsql client that is never queried               |
| `seed.ts` (`wrangler d1 execute`)                                     | `libsql-seed.ts`: migrations, then the admin, through the libsql client; no wrangler |
| `index.ts`                                                            | `libsql-index.ts`                                                                    |
| `auth.flow.test.ts`, `auth.organization.test.ts`, `auth.seed.test.ts` | the same tests importing `libsql-auth.module`; `libsql-seed.test.ts` for the seed    |

`vp run db:seed` applies `packages/db/migrations` (run `vp run db:generate` in `packages/db` first) to
`<DATA_DIR>/db.sqlite` and inserts the same admin as the D1 seed, once: a second run says so and changes nothing.
There is no `db:reset` on libsql: start over by deleting the database file. `BETTER_AUTH_SECRET` is the module's env
key, as on Cloudflare; `provider/dockerfile`'s `readRuntimeEnv` generates it under `DATA_DIR/secrets` when unset.
The variant depends on `@libsql/client` and has no Cloudflare, miniflare or wrangler dependency.

## Wiring

The module writes nothing outside `packages/auth` by copy. It reaches the rest of the project through
five patches on four known seams, each with the sentence a failure turns into a pending intention:

| Type                   | File                              | Regions                          |
| ---------------------- | --------------------------------- | -------------------------------- |
| `package.dependencies` | `apps/api/package.json`           | `dependencies.{{SCOPE}}/auth`    |
| `ts.addImport`         | `apps/api/src/app.ts`             | `imports[{{SCOPE}}/auth]`        |
| `ts.elysiaUse`         | `apps/api/src/app.ts`             | `elysia[app].use[authModule]`    |
| `package.dependencies` | `packages/db/package.json`        | `dependencies.{{SCOPE}}/auth`    |
| `ts.addNamedExport`    | `packages/db/src/schema/index.ts` | `exports[{{SCOPE}}/auth/schema]` |

`.use(authModule)` lands after `.use(dbModule)`, which `orm/drizzle` put there. The export is every table
and relation of `schema.ts` (a contract test compares the two lists), so `vp run db:generate` in
`packages/db` writes the auth tables into the project's one migration, and `createDB` sees them.

The wiring makes three workspace cycles: `api` and `auth` (the shell mounts auth, auth reads the shell's
`lib/*`), `db` and `auth` (the barrel re-exports auth's tables, auth reads `createDB`), and so `db`, `api`,
`auth` in a ring. bun and pnpm install it, `tsc` and Vitest resolve it, and golden runs all three. A module
cycle would not work and there is none: `schema.ts` imports nothing of the project, and nothing of `auth`
runs at import time.

**The barrel keeps its `export {};`.** It is `orm/drizzle`'s, there so the file is a module while empty;
once a module re-exports from it, `vp check` reports it as an empty export (a warning). Removing it takes
a patch the catalog does not have.

## Seed

`vp run db:seed` (in `packages/auth`) applies the migrations to the local D1 and inserts an admin,
`admin@example.local` / `password123`, verified, who owns a Personal organization. The legacy seed was
`db.seed.ts`, in the ORM's directory, because it sat in `apps/api`; every statement of it inserts into
`user`, `account`, `organization` or `member` and hashes a password, so it is auth's. `drizzle/seed.sql` was
referenced by nothing and is not shipped.

**It deletes nothing, and `db:reset` is not auth's.** Resetting a database means emptying every table the
schema barrel exports, the other modules' and the project's own included, in an order a foreign key accepts,
and the barrel is `orm/drizzle`'s: its `vp run db:reset` (in `packages/db`) does that
([`orm/drizzle`](../../orm/drizzle/README.md#resetting-the-database)). Auth's reset cleared auth's tables and only those,
so it failed once a `medias` row had an author and no organization (`storage`'s `author_id` has no cascade),
and no module could add a step to it. What it leaves behind is a database `db:seed` works on, so starting
over is `db:reset`, then `db:seed`.

**A second `db:seed` changes nothing.** The admin is the user with `admin@example.local`, whatever else that
user holds. When the database has one, the seed does not touch it, prints
`Already seeded: admin@example.local exists, so nothing was changed` and exits 0, so a script can run it every
time. A person who signed up with that email keeps the password they chose. The inserts stay one
`wrangler d1 execute` call, which D1 runs as a transaction: a seed that fails midway leaves no user without its
organization (observed on a local D1 with the `personal` slug already taken: no user, no account, no member),
and the unique `user.email` still refuses a second admin if two seeds start at once. The seed before this one
cleared the auth tables first, which is what `db:reset` is for now.

`seedAdmin(database)` looks for the admin and, when there is none, applies `seedStatements()`, a pure function
that builds the SQL. The tests run both against real SQLite and read the result back through Better Auth: the
admin signs in, the wrong password is refused, a seed on a database that has the admin adds no row and answers
`present`, and it seeds again after the ORM's `resetStatements` has emptied the auth tables. The runner only hands
them to `wrangler d1 execute DB --local` from `apps/api` (the `wrangler` it depends on): the database is addressed by its binding, as
`db/d1`'s scripts do, not by the name in `wrangler.jsonc`. Golden runs `db:seed`, puts a row in every other
table, runs `db:reset`, runs `db:seed` again, and once more on the seeded database, where it has to say so and
leave every table with the rows it had.

## Roles and permissions

`src/permissions.ts` is the one file that says what a role may do. It builds `ac` (`createAccessControl`)
over `statements`, which start as the organization plugin's own (`organization`, `member`, `invitation`, `team`,
`ac`), and `roles = { owner, admin, member }` from the plugin's default definitions, so nothing changes until you
edit it. `createAuth` hands both to `organization({ ac, roles })`, and the SPA's `organizationClient` takes the
same two from `{{SCOPE}}/auth/permissions`, so the server and the front check the same table. The file imports
nothing server-side.

To add a resource, put it in `statements` (`projects: ["create", "update", "delete"]`) and grant it to a role in
`roles` (`admin: ac.newRole({ ...adminAc.statements, projects: ["create", "update"] })`). The roles are fixed:
`owner`, `admin` and `member` stay the only names.

A route asks for a permission with the macro beside `auth`:

```ts
app.post("/projects", handler, { permission: { projects: ["create"] } });
```

It answers 401 with no session, 403 when the role of the member in the session's active organization lacks any of
the statements (also when there is no active organization or the user is not a member of it), and runs the handler
otherwise. It checks with `auth.api.hasPermission`, so it reads the same role table as Better Auth's own endpoints.
It adds nothing to the context: combine it with `auth: true` to get `user` and `session`. Both variants mount the
same macro from `permission.macro.ts`.

## Organizations marked deleted

`organization.deletedAt` is the soft delete: server-side only (`input: false`), read by the macro and the
session hook, written by nothing in this module. Better Auth's organization endpoints do not know it.
Observed on real SQLite, an organization with `deletedAt` set was still returned by `organization/list`,
fetched with its members by `get-full-organization` (by id, by slug, or as the active one), and accepted
by `set-active`, which scopes what a route reads. Now `list` drops it, `get-full-organization` and
`set-active` answer 404 (`set-active` before it touches the session), and the `auth: true` macro treats a
session whose active organization was deleted since as having none: it falls back to the user's first live
one and keeps that in the session (one primary-key read per authenticated request). `auth.organization.test.ts`
pins each. The hooks match on Better Auth's paths, as the rate-limit rules do; the tests are what notice a
rename.

**Not changed: `organization/delete` hard-deletes.** It removes the row, and the members with it (foreign
key cascade), for any owner who calls it. The legacy SPA never calls it, and nothing in the repo writes
`deletedAt`, so which of the two is the product's delete is not decided here. `disableOrganizationDeletion`
would close it; it is a behaviour change and waits for whoever writes `deletedAt`.

## Rate limit and the client's address

Better Auth limits by client address and, told nothing, reads `x-forwarded-for` alone. Workers do not
set it, so every client fell into one bucket per path and sign-in was capped at ten a minute for all of
them together. `createAuth` takes `clientIpHeaders`, and `auth.module.ts` passes the one the provider's
`{{SCOPE}}/api-runtime` exports: `cf-connecting-ip` on `cloudflare`, which the edge sets and overwrites,
and `x-client-ip` on `dockerfile`, which that runtime stamps from the socket (or from the proxy header the
operator names), because with the port published `x-forwarded-for` is the client's to set. Auth names no
provider. `auth.rate-limit.test.ts` pins it: one client is throttled, another is not, and a forged
`x-forwarded-for` does not pick a bucket.

The custom rules are per client and per minute: ten on `/sign-in/email`, five each on `/sign-up/email`,
`/request-password-reset` and `/reset-password`, a hundred on the rest. A rule is matched on the path
Better Auth serves, relative to the base path, and one that matches nothing is ignored without a word:
the legacy `/forget-password` rule matched nothing since 1.6 renamed the endpoint, so the built-in three a
minute applied. A test asks that every rule name a path the instance serves.

The limits live in Better Auth's memory store, per isolate on Workers.

## Not here

- **`authService` and `dbService`** of the legacy module, which decorated the context with the auth
  instance and an empty `db`. Nothing read them but the macro.
- **`lib/email.ts` and the React emails** (the `email` module's), and `getAuthClientConfig`, which
  nothing imported.
