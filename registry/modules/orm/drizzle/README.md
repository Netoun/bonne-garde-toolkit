# orm/drizzle

The ORM over the installed `db` module: the Drizzle client, the schema barrel every module's tables are
re-exported from, the drizzle-kit config and a test database in real SQLite. It writes into
`packages/db`, which `db/d1` owns.

```bash
bunx bonne-garde add provider/cloudflare db/d1 orm/drizzle
```

## Peers and variant

`peers: { api: ["elysia"], db: [] }`: the API, whose `app.ts` and `package.json` its patches wire the
`dbModule` into, and any `db` module, one of which has to be installed. There is one variant per db, matched
on `db`: `d1`, `libsql` and `postgres`. The allow-list stays empty so that a project with a `db` this module has no variant
for fails with "no variant matches", listing what is available.

## What it writes

| File                                  | What it is                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/schema/index.ts`                 | the barrel: empty, and where tables are registered                                             |
| `src/client.ts`                       | `createDB(d1)` and `type DB`: `drizzle-orm/d1` over the barrel                                 |
| `src/module.ts`                       | `dbModule`, the Elysia plugin that derives `db`; `dbPlugin(readBinding)` builds it             |
| `src/index.ts`                        | `createDB`, `DB`, `dbModule`, `dbPlugin`                                                       |
| `src/drizzle.config.ts`               | `schema: ./src/schema/index.ts`, `out: ./migrations`, `dialect: sqlite`                        |
| `src/testing.ts`                      | `createTestDb(schema?)`: an in-memory SQLite with the schema's tables                          |
| `src/reset.ts`                        | `resetStatements(schema?)` and `vp run db:reset`: empties every table the barrel exports       |
| `src/{client,module,testing}.test.ts` | seven tests: two against a real D1 (Miniflare), three against real SQLite, two with no binding |
| `src/reset.test.ts`                   | nine tests: the order of the deletes, on real SQLite and on a real D1 (Miniflare)              |

`dbModule` reads the binding through `db/d1`'s `readD1()` for each request, and derives `db` for the
routes registered after it. With no binding it still loads: see `db/d1`.

## The `libsql` variant

With [`db/libsql`](../../db/libsql/README.md) (the `dockerfile` provider) the same package runs on
`drizzle-orm/libsql`. A module has one `template/`, so its files sit beside the D1 ones at distinct paths, and
the variant copies only its own plus the shared `src/drizzle.config.ts` and `src/schema/index.ts`:

| File                    | What it is                                                                            |
| ----------------------- | ------------------------------------------------------------------------------------- |
| `src/libsql-client.ts`  | `createDB(client)` and `type DB`                                                      |
| `src/libsql-module.ts`  | `dbModule` / `dbPlugin(readDatabase, migrationsFolder?)`: applies the migrations once |
| `src/libsql-index.ts`   | the same exports as `index.ts`                                                        |
| `src/libsql-testing.ts` | `createTestDb(schema?)` / `TestDb` over a libsql `:memory:` client                    |
| `src/libsql-*.test.ts`  | each against a real libsql database                                                   |

It patches `packages/db/package.json` with the root export `./src/libsql-index.ts`, `./schema`, `./testing`
(`./src/libsql-testing.ts`) and the `db:generate` script only (no `db:reset`, no `db:studio`), and wires
`dbModule` into the API with the same three patches as `d1`. `db/d1` and its files are unchanged.

## The `postgres` variant

With [`db/postgres`](../../db/postgres/README.md) (the `dockerfile` provider) the package runs on
`drizzle-orm/postgres-js`, over the client `readPostgres()` returns. Same layout as `libsql`, with the barrel the
only file shared with the other variants:

| File                             | What it is                                                                                             |
| -------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/postgres-client.ts`         | `createDB(sql)` and `type DB`                                                                          |
| `src/postgres-module.ts`         | `dbModule` / `dbPlugin(readDatabase, migrationsFolder?)`: applies the migrations once                  |
| `src/postgres-index.ts`          | the same exports as `index.ts`                                                                         |
| `src/postgres-test-db.ts`        | `createTestDb(schema?)` / `TestDb`: a fresh PGlite served over a socket, behind the postgres-js driver |
| `src/postgres-drizzle.config.ts` | `dialect: postgresql`, `out: ./migrations`, `dbCredentials.url` from `DATABASE_URL`                    |
| `src/postgres-*.test.ts`         | each against a real Postgres engine (PGlite over its socket), no Docker                                |

The test database is `postgres-test-db.ts` and not `postgres-testing.ts`: that path is `db/postgres`'s
(`startTestPostgres`). `createTestDb` starts a server of its own on each call and leaves it to the end of the test
process.

It patches `packages/db/package.json` with the root export `./src/postgres-index.ts`, `./schema`, `./testing`
(`./src/postgres-test-db.ts`) and the `db:generate` script (`drizzle-kit generate --config
./src/postgres-drizzle.config.ts`) only, and wires `dbModule` into the API with the same three patches as `d1`.

`dbModule` applies the migrations on the first request, with `migrate` of `drizzle-orm/postgres-js/migrator`,
once for requests at the same time. It skips them, and the API still answers `/health`, when `db:generate` has not
written `migrations/meta/_journal.json` yet or when `DATABASE_URL` is unset (the first query then fails naming it).

## `packages/db` is shared, and db/d1 owns it

035 gives `db` and `orm` one directory. The planner generates or vendors one `package.json` per variant
that has a workspace, and refuses a second claimant (`named by both` in one call, `owned by` in two), so
exactly one module may. `db/d1` is first in 035's order and the only one that can stand alone, so it
owns the workspace and the vendored `package.json`, and orm adds to that file with patches, one
region each, which `bunx bonne-garde remove orm/drizzle` deletes and nothing else:

| Type                   | Regions                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `jsonc.merge`          | `exports."."`, `exports."./reset"`, `exports."./schema"`, `exports."./testing"`  |
| `package.dependencies` | `dependencies.drizzle-orm`, `dependencies.elysia`, `devDependencies.drizzle-kit` |
| `scripts.merge`        | `scripts.db:generate`, `scripts.db:reset`, `scripts.db:studio`                   |

The dependencies are a patch because the variant's maps reach only a `package.json` the module writes,
and this one is db/d1's. `package.dependencies` writes each entry where the formatter sorts it, so
`drizzle-kit` lands between db/d1's `@cloudflare/workers-types` and `miniflare` and `vp run check`
has nothing to say. `drizzle-kit` is a dev dependency: `./testing` imports `drizzle-kit/api`, which a
workspace package resolves from its own devDependencies.

## Wiring into the API (060)

`dbModule` is this module's: `{{SCOPE}}/db` serves it at its root export, which orm adds, and `db/d1`
alone exports only `./d1`. So orm wires it, with three patches on the files `api/elysia` ships:

| Type                   | File                    | Region                                             |
| ---------------------- | ----------------------- | -------------------------------------------------- |
| `package.dependencies` | `apps/api/package.json` | `dependencies.{{SCOPE}}/db` (`workspace:*`)        |
| `ts.addImport`         | `apps/api/src/app.ts`   | `imports[{{SCOPE}}/db]`: `dbModule`                |
| `ts.elysiaUse`         | `apps/api/src/app.ts`   | `elysia[app].use[dbModule]`, after the last `.use` |

The dependency is what lets the import resolve: bun's isolated installs and pnpm link only what a
`package.json` declares. Like `db/d1`, orm does not peer on `api`: without `apps/api` the three fail and become pending
intentions (060), not a failed install. With it, in one call or after, `bonne-garde add` of either module alone
later skips every patch and changes nothing.

Every route registered after it has `db` on its context. The API shell's own tests, and every route
that does not query, still load and answer with no binding (see `db/d1`).

## Schemas, not SQL

A module ships tables, never migrations. The legacy `0000` migration mixes the `auth` tables with
`medias`, and a project that installs one without the other would apply tables it does not have.
The project generates its own:

```bash
cd packages/db && vp run db:generate     # drizzle-kit: schema barrel -> migrations/0000_*.sql
cd apps/api && vp run db:migrate:local   # wrangler d1 migrations apply DB --local
```

`migrations/` is where `db/d1`'s `migrations_dir` points, and `tooling/vite-plus` does not format it
(drizzle-kit rewrites its JSON on every run).

**Tables are the owning module's.** A module keeps its tables in its own package and adds them to the
barrel with `ts.addNamedExport`, region `exports[<specifier>]`:

```ts
export { user, session } from "@scope/auth/schema";
export { medias } from "@scope/storage/schema";
```

**That line resolves once `packages/db` depends on `@scope/auth`.** bun's isolated installs and pnpm give
`packages/db` only what its own `package.json` declares (`tsc`: TS2307, `drizzle-kit`:
`MODULE_NOT_FOUND` otherwise), so the module that adds the table adds that dependency to
`packages/db/package.json` with a `package.dependencies` patch, next to the line. It makes a workspace
cycle, since `auth` imports `createDB` from `{{SCOPE}}/db`, which bun and pnpm accept.

The barrel is empty because the one table of the legacy `db.core-schema.ts`, `medias`, has foreign
keys onto `user` and `organization`: it belongs to `storage`, which comes after `auth`, and cannot be
in a module that precedes it. A project's own tables are a file next to the barrel and a line in it.
Golden does exactly that with `golden_notes`.

## Resetting the database

`vp run db:reset` (in `packages/db`) empties every table the schema barrel exports, in the local D1 the
binding `DB` names in `apps/api/wrangler.jsonc`, and prints the tables it emptied. It is this module's because
this module owns the barrel: the tables are other modules' (`auth`, `storage`) and the project's own, and the
only thing that knows all of them is the file they are re-exported from. It reads the barrel when it runs, so a
module added later is reset with no change here. Nothing else is touched: no migration runs, and `d1_migrations`
is not in the barrel, so what is applied stays applied. Putting rows back is the module's: `auth`'s
`vp run db:seed` inserts the admin, and works on a database this has emptied.

```bash
cd packages/db && vp run db:reset       # every table of the barrel, children before parents
cd ../auth && vp run db:seed            # the admin, who owns a Personal organization
```

**The order is the foreign keys.** `resetStatements(schema?)` is one `DELETE FROM "<table>";` per table, each
before the tables it points at, which it reads from `getTableConfig(table).foreignKeys`. A reference to the table
itself is not an ordering (one statement deletes all its rows), nor is a reference to a table the schema does not
hold. Two tables that point at each other have no order, whatever their `ON DELETE`: the error names them, and the
reset does not run. The statements run in one `wrangler d1 execute`.

Deferring the checks was the alternative, and it was tried on the local D1 that `wrangler` runs. `PRAGMA
foreign_keys = OFF` is not honoured: with a media that had an author and no organization, `PRAGMA foreign_keys
= OFF; DELETE FROM "user";` still failed on the foreign key. `PRAGMA defer_foreign_keys = on` in the same
`--command` did let the parent go first. The order was taken anyway: it needs no pragma, it is the same
statements on D1 and on `node:sqlite`, where the tests run them, and it fails loudly on the one schema deferral
would let through, a cycle. A table with a cascade needs no special case: `ON DELETE CASCADE` on
`medias.organization_id` is why a media of an organization never stopped a reset, and the nullable `author_id`
with no cascade is why one with no organization did.

`reset.test.ts` proves it on real databases: on the test database with `PRAGMA foreign_keys = ON` (it is
already on there, as on D1; the pragma keeps the test true of any SQLite) and on a D1 from Miniflare, where it first shows that
deleting a parent first is refused. The `./reset` export is for other modules' tests (`auth`'s seed test and
`storage`'s run `resetStatements` over their own tables). Golden runs the script itself against a local D1
holding a media with an author and no organization, a row in `golden_notes` and the seeded admin.

## The test database

`createTestDb()` is a fresh in-memory D1 with the tables of the barrel, or of the schema you pass:
`await createTestDb({ notes })`. It is D1's interface over `node:sqlite`, behind the Drizzle driver the API
uses, `drizzle-orm/d1`: a raw read gives objects and a typed one arrays, as on D1, foreign keys are
enforced, and a batch is one transaction. `testing.test.ts` runs the same reads, writes, foreign key and
failed batch on it and on a D1 from Miniflare and expects the same answers. It is not Miniflare itself
because each Miniflare is a workerd process that no test would dispose. The tables come from the schema
through `drizzle-kit/api`, not from `migrations/`, so a test does not wait for `vp run db:generate`, and
the tests that run against D1 itself use Miniflare (`client.test.ts`, `module.test.ts`). It is async where
the legacy `createTestDb` was not, because `drizzle-kit/api` is.

## Not here

- **The seed.** Every statement of the legacy `db.seed.ts` and of `drizzle/seed.sql` inserts into
  `user`, `account`, `organization` or `member`, and hashes a password: it is `auth`'s. `seed.sql` is
  referenced by nothing. The reset is here; the legacy `db:reset` ran the seed after it, and this one does not.
- **`dbService`.** It decorated `db` and `env` with empty objects to give other modules the types.
  `dbModule` has a `name`, so Elysia applies it once however many modules `.use` it.
