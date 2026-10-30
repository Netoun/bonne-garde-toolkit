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

| File                                  | What it is                                                                         |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `src/schema/index.ts`                 | the barrel: empty, and where tables are registered                                 |
| `src/client.ts`                       | `createDB(d1)` and `type DB`: `drizzle-orm/d1` over the barrel                     |
| `src/module.ts`                       | `dbModule`, the Elysia plugin that derives `db`; `dbPlugin(readBinding)` builds it |
| `src/index.ts`                        | `createDB`, `DB`, `dbModule`, `dbPlugin`                                           |
| `src/drizzle.config.ts`               | `schema: ./src/schema/index.ts`, `out: ./migrations`, `dialect: sqlite`            |
| `src/testing.ts`                      | `createTestDb(schema?)`: an in-memory SQLite with the schema's tables              |
| `src/{client,module,testing}.test.ts` | seven tests: three of them against a real D1, the rest against real SQLite         |

`dbModule` reads the binding through `db/d1`'s `readD1()` for each request, and derives `db` for the
routes registered after it. With no binding it still loads: see `db/d1`.

## `packages/db` is shared, and db/d1 owns it

035 gives `db` and `orm` one directory. The planner generates or vendors one `package.json` per variant
that has a workspace, and refuses a second claimant (`named by both` in one call, `owned by` in two), so
exactly one module may. `db/d1` is first in 035's order and the only one that can stand alone, so it
owns the workspace and the vendored `package.json`, and orm adds to that file with patches, one
region each, which `bg remove orm/drizzle` deletes and nothing else:

| Type            | Regions                                                                                                                                   |
| --------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `jsonc.merge`   | `exports."."`, `exports."./schema"`, `exports."./testing"`; `dependencies.drizzle-kit`, `dependencies.drizzle-orm`, `dependencies.elysia` |
| `scripts.merge` | `scripts.db:generate`, `scripts.db:studio`                                                                                                |

**The dependencies are in `jsonc.merge`, not in the variant**, which 050 says is where they come from.
The variant's maps reach only a `package.json` the module writes, and this one is db/d1's. Two things
follow, both pinned by the contract test: the versions are exact by the test and not by the variant
check, and a name has to sort after the ones already in its map, because `jsonc.merge` appends and the
formatter's `sortPackageJson` sorts (`@scope/api-runtime` and `@cloudflare/workers-types` come first,
then `drizzle-kit`, `drizzle-orm`, `elysia`). That is why `drizzle-kit`, which `./testing` imports at
run time (`drizzle-kit/api`), is a dependency and not a dev dependency: `miniflare`, db/d1's, would
sort after it.

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

The barrel is empty because the one table of the legacy `db.core-schema.ts`, `medias`, has foreign
keys onto `user` and `organization`: it belongs to `storage`, which comes after `auth`, and cannot be
in a module that precedes it. A project's own tables are a file next to the barrel and a line in it.
Golden does exactly that with `golden_notes`.

## The test database

`createTestDb()` is a fresh in-memory SQLite (`bun:sqlite`) with the tables of the barrel, or of the
schema you pass: `await createTestDb({ notes })`. The tables come from the schema through
`drizzle-kit/api`, not from `migrations/`, so a test does not wait for `bun run db:generate`, and the
tests that run against D1 itself use Miniflare (`client.test.ts`, `module.test.ts`). It is async where
the legacy `createTestDb` was not, because `drizzle-kit/api` is.

## Not here

- **Wiring `.use(dbModule)` into `apps/api/src/app.ts`.** `ts.addImport` and `ts.elysiaUse` are built and
  keep the file what the formatter writes, but `apps/api` cannot import `{{SCOPE}}/db` until its
  `package.json` depends on it, and with Bun's isolated installs it fails to resolve it without that.
  No patch can write the line: `jsonc.merge` refuses `{{SCOPE}}`, so a dependency on a sibling package
  cannot be named. `auth` and `storage` will meet the same wall.
- **The seed.** Every statement of the legacy `db.seed.ts` and of `drizzle/seed.sql` inserts into
  `user`, `account`, `organization` or `member`, and hashes a password: it is `auth`'s. `seed.sql` is
  referenced by nothing.
- **`dbService`.** It decorated `db` and `env` with empty objects to give other modules the types.
  `dbModule` has a `name`, so Elysia applies it once however many modules `.use` it.
