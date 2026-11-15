# orm/drizzle

The ORM over the installed `db` module: the Drizzle client, the schema barrel every module's tables are
re-exported from, the drizzle-kit config and a test database in real SQLite. It writes into
`packages/db`, which `db/d1` owns.

```bash
bunx bg add provider/cloudflare db/d1 orm/drizzle
```

## Peers and variant

`peers: { db: [] }`: any `db` module, one of which has to be installed. The one variant, `d1`, is
matched on `db: d1`; a `libsql` database would bring a variant of its own, with `drizzle-orm/libsql`,
and the allow-list stays empty so that a project with a `db` this module has no variant for fails with
"no variant matches", listing what is available.

## What it writes

| File                                  | What it is                                                                                     |
| ------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `src/schema/index.ts`                 | the barrel: empty, and where tables are registered                                             |
| `src/client.ts`                       | `createDB(d1)` and `type DB`: `drizzle-orm/d1` over the barrel                                 |
| `src/module.ts`                       | `dbModule`, the Elysia plugin that derives `db`; `dbPlugin(readBinding)` builds it             |
| `src/index.ts`                        | `createDB`, `DB`, `dbModule`, `dbPlugin`                                                       |
| `src/drizzle.config.ts`               | `schema: ./src/schema/index.ts`, `out: ./migrations`, `dialect: sqlite`                        |
| `src/testing.ts`                      | `createTestDb(schema?)`: an in-memory SQLite with the schema's tables                          |
| `src/reset.ts`                        | `resetStatements(schema?)` and `bun run db:reset`: empties every table the barrel exports      |
| `src/{client,module,testing}.test.ts` | seven tests: two against a real D1 (Miniflare), three against real SQLite, two with no binding |
| `src/reset.test.ts`                   | nine tests: the order of the deletes, on real SQLite and on a real D1 (Miniflare)              |

`dbModule` reads the binding through `db/d1`'s `readD1()` for each request, and derives `db` for the
routes registered after it. With no binding it still loads: see `db/d1`.

## `packages/db` is shared, and db/d1 owns it

035 gives `db` and `orm` one directory. The planner generates or vendors one `package.json` per variant
that has a workspace, and refuses a second claimant (`named by both` in one call, `owned by` in two), so
exactly one module may. `db/d1` is first in 035's order and the only one that can stand alone, so it
owns the workspace and the vendored `package.json`, and orm adds to that file with patches, one
region each, which `bg remove orm/drizzle` deletes and nothing else:

| Type                   | Regions                                                                          |
| ---------------------- | -------------------------------------------------------------------------------- |
| `jsonc.merge`          | `exports."."`, `exports."./reset"`, `exports."./schema"`, `exports."./testing"`  |
| `package.dependencies` | `dependencies.drizzle-orm`, `dependencies.elysia`, `devDependencies.drizzle-kit` |
| `scripts.merge`        | `scripts.db:generate`, `scripts.db:reset`, `scripts.db:studio`                   |

The dependencies are a patch because the variant's maps reach only a `package.json` the module writes,
and this one is db/d1's. `package.dependencies` writes each entry where the formatter sorts it, so
`drizzle-kit` lands between db/d1's `@cloudflare/workers-types` and `miniflare` and `bun run check`
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

The dependency is what lets the import resolve: Bun's isolated installs link only what a `package.json`
declares. Like `db/d1`, orm does not peer on `api`: without `apps/api` the three fail and become pending
intentions (060), not a failed install. With it, in one call or after, `bg add` of either module alone
later skips every patch and changes nothing.

Every route registered after it has `db` on its context. The API shell's own tests, and every route
that does not query, still load and answer with no binding (see `db/d1`).

## Schemas, not SQL

A module ships tables, never migrations. The legacy `0000` migration mixes the `auth` tables with
`medias`, and a project that installs one without the other would apply tables it does not have.
The project generates its own:

```bash
cd packages/db && bun run db:generate     # drizzle-kit: schema barrel -> migrations/0000_*.sql
cd apps/api && bun run db:migrate:local   # wrangler d1 migrations apply DB --local
```

`migrations/` is where `db/d1`'s `migrations_dir` points, and `tooling/vite-plus` does not format it
(drizzle-kit rewrites its JSON on every run).

**Tables are the owning module's.** A module keeps its tables in its own package and adds them to the
barrel with `ts.addNamedExport`, region `exports[<specifier>]`:

```ts
export { user, session } from "@scope/auth/schema";
export { medias } from "@scope/storage/schema";
```

**That line resolves once `packages/db` depends on `@scope/auth`.** Bun's isolated installs give
`packages/db` only what its own `package.json` declares (`tsc`: TS2307, `drizzle-kit`:
`MODULE_NOT_FOUND` otherwise), so the module that adds the table adds that dependency to
`packages/db/package.json` with a `package.dependencies` patch, next to the line. It makes a workspace
cycle, since `auth` imports `createDB` from `{{SCOPE}}/db`, which Bun accepts.

The barrel is empty because the one table of the legacy `db.core-schema.ts`, `medias`, has foreign
keys onto `user` and `organization`: it belongs to `storage`, which comes after `auth`, and cannot be
in a module that precedes it. A project's own tables are a file next to the barrel and a line in it.
Golden does exactly that with `golden_notes`.

## Resetting the database

`bun run db:reset` (in `packages/db`) empties every table the schema barrel exports, in the local D1 the
binding `DB` names in `apps/api/wrangler.jsonc`, and prints the tables it emptied. It is this module's because
this module owns the barrel: the tables are other modules' (`auth`, `storage`) and the project's own, and the
only thing that knows all of them is the file they are re-exported from. It reads the barrel when it runs, so a
module added later is reset with no change here. Nothing else is touched: no migration runs, and `d1_migrations`
is not in the barrel, so what is applied stays applied. Putting rows back is the module's: `auth`'s
`bun run db:seed` inserts the admin, and works on a database this has emptied.

```bash
cd packages/db && bun run db:reset      # every table of the barrel, children before parents
cd ../auth && bun run db:seed           # the admin, who owns a Personal organization
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
statements on D1 and on `bun:sqlite`, where the tests run them, and it fails loudly on the one schema deferral
would let through, a cycle. A table with a cascade needs no special case: `ON DELETE CASCADE` on
`medias.organization_id` is why a media of an organization never stopped a reset, and the nullable `author_id`
with no cascade is why one with no organization did.

`reset.test.ts` proves it on real databases: on `bun:sqlite` with `PRAGMA foreign_keys = ON` (it is off by
default there, so a test without it proves nothing) and on a D1 from Miniflare, where it first shows that
deleting a parent first is refused. The `./reset` export is for other modules' tests (`auth`'s seed test and
`storage`'s run `resetStatements` over their own tables). Golden runs the script itself against a local D1
holding a media with an author and no organization, a row in `golden_notes` and the seeded admin.

## The test database

`createTestDb()` is a fresh in-memory SQLite (`bun:sqlite`) with the tables of the barrel, or of the
schema you pass: `await createTestDb({ notes })`. The tables come from the schema through
`drizzle-kit/api`, not from `migrations/`, so a test does not wait for `bun run db:generate`, and the
tests that run against D1 itself use Miniflare (`client.test.ts`, `module.test.ts`). It is async where
the legacy `createTestDb` was not, because `drizzle-kit/api` is.

## Not here

- **The seed.** Every statement of the legacy `db.seed.ts` and of `drizzle/seed.sql` inserts into
  `user`, `account`, `organization` or `member`, and hashes a password: it is `auth`'s. `seed.sql` is
  referenced by nothing. The reset is here; the legacy `db:reset` ran the seed after it, and this one does not.
- **`dbService`.** It decorated `db` and `env` with empty objects to give other modules the types.
  `dbModule` has a `name`, so Elysia applies it once however many modules `.use` it.
