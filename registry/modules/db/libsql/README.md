# db/libsql

The database of a `provider/dockerfile` project: one SQLite file, `<DATA_DIR>/db.sqlite`, opened once per
process through [libsql](https://github.com/tursodatabase/libsql-client-ts). `packages/db` is shared with
[`orm/drizzle`](../../orm/drizzle/README.md), whose `libsql` variant builds the Drizzle client, the plugin and
the test database on it. `db/d1` is the Cloudflare counterpart; a project has one of the two.

```bash
bunx bonne-garde add provider/dockerfile db/libsql orm/drizzle
```

## Peers

| Peer       | Allow-list   | Why                                                                                  |
| ---------- | ------------ | ------------------------------------------------------------------------------------ |
| `provider` | `dockerfile` | `src/libsql.ts` reads `DATA_DIR` through `readRuntimeEnv` of `{{SCOPE}}/api-runtime` |
| `api`      | `elysia`     | the `libsql` variant of `orm/drizzle` wires `dbModule` into `apps/api`               |

A project on `provider/cloudflare` is refused (`db/libsql accepts only dockerfile for provider`). One default
variant. The module declares no `env`: `DATA_DIR` is the provider's (`/data` in the image, `.data` otherwise).

## What it writes

| File                 | What it is                                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------- |
| `package.json`       | `{{SCOPE}}/db`: the `./libsql` export, the `typecheck` and `test` scripts; `@libsql/client` |
| `tsconfig.json`      | extends the project's, with the tests                                                       |
| `src/libsql.ts`      | `readLibsql()`: the client over `<DATA_DIR>/db.sqlite`                                      |
| `src/libsql.test.ts` | the path, the directory, one client per file, a `select 1`                                  |

`readLibsql()` creates the directory when it is missing and keeps one promise per file, so every request, and
two first requests at once, get the same client. The tests use a real libsql file in a temp directory.

## Migrations

`vp run db:generate` (in `packages/db`, from `orm/drizzle`) writes `packages/db/migrations`. There is no
`db:migrate`: the plugin applies them itself, with `migrate` from `drizzle-orm/libsql/migrator`, once, on the
first request, from the folder next to `src` (found from the file, not the cwd). Without a `meta/_journal.json`
there is nothing to apply and the API starts. Applied migrations are recorded in `__drizzle_migrations`, so a
restart runs none again. `db:reset` and `db:studio` are not shipped: they need wrangler or credentials.

## Not here

`auth/better-auth` has a `libsql` variant over this database ([its README](../../auth/better-auth/README.md#dockerfile-and-libsql)). `storage/r2` stays D1-only (`peers.db: ["d1"]`).
A Postgres database is [`db/postgres`](../postgres/README.md), over `DATABASE_URL`.
