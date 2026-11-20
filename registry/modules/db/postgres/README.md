# db/postgres

A Postgres database for a `provider/dockerfile` project: the app reads `DATABASE_URL` (an external Postgres in
production) and opens one [postgres-js](https://github.com/porsager/postgres) client per URL. A dev compose file
starts a local Postgres. `db/libsql` is the SQLite-file alternative, `db/d1` the Cloudflare one; a project has
one of the three.

```bash
bunx bonne-garde add provider/dockerfile db/postgres
cd packages/db && vp run db:up
```

## Peers

| Peer       | Allow-list   | Why                                                                                        |
| ---------- | ------------ | ------------------------------------------------------------------------------------------ |
| `provider` | `dockerfile` | `src/postgres.ts` reads `DATABASE_URL` through `readRuntimeEnv` of `{{SCOPE}}/api-runtime` |
| `api`      | `elysia`     | the ORM stage that follows wires its plugin into `apps/api`                                |

A project on `provider/cloudflare` is refused (`db/postgres accepts only dockerfile for provider`), and so is
one that already has `db/libsql` (one `db`). One default variant.

## What it writes

| File                      | What it is                                                                                           |
| ------------------------- | ---------------------------------------------------------------------------------------------------- |
| `compose.postgres.yaml`   | `postgres:17-alpine` on `127.0.0.1:5432`, a named volume, a `pg_isready` healthcheck. Local dev only |
| `package.json`            | `{{SCOPE}}/db`: the `./postgres` export, `typecheck`, `test`, `db:up`, `db:down`; `postgres`         |
| `tsconfig.json`           | extends the project's, with the tests                                                                |
| `src/postgres.ts`         | `readPostgres()`: the client over `DATABASE_URL`; `isUnbound(sql)`                                   |
| `src/postgres-testing.ts` | `startTestPostgres()` → `{ url, stop }`: an in-memory PGlite served over a socket (dev dependency)   |
| `src/postgres.test.ts`    | `select 1`, one client per URL, the unbound client                                                   |

`DATABASE_URL` is the module's `env` entry, so `.env.example` holds the local URL
(`postgres://postgres:postgres@localhost:5432/app`). It reaches the container through the project's `.env`,
which the provider's `compose.yaml` forwards whole: that file is not touched.

`readPostgres()` keeps one client per URL; postgres-js opens no connection until the first query. With
`DATABASE_URL` blank or unset it returns an unbound client, so the API still loads and `/health` answers; the
first query fails with an error naming `DATABASE_URL` and `vp run db:up`. `isUnbound(sql)` tells it apart, so a
plugin can skip its migrations.

The tests run on a real Postgres engine (PGlite over `PGLiteSocketServer`) with the production driver: no mock,
no Docker. PGlite serves one connection at a time, so a client against it takes `{ max: 1 }`.

## Migrations

They come with [`orm/drizzle`](../../orm/drizzle/README.md) (its `postgres` variant), not from this module:

```bash
bunx bonne-garde add db/postgres orm/drizzle
cd packages/db
vp run db:up         # the local Postgres of compose.postgres.yaml
vp run db:generate   # after a table is added to src/schema/index.ts: writes migrations/
```

The API applies `migrations/` itself, on its first request, so there is no migrate step to run: with
`DATABASE_URL` pointing at a Postgres, the first request creates the tables. A project with no migration yet, or
no `DATABASE_URL`, still starts and answers `/health`.

## Not here

The ORM comes with `orm/drizzle`. `auth/better-auth` (`peers.db: ["d1", "libsql"]`) and `storage/r2` (`["d1"]`) do not accept it:
auth on Postgres waits for a project that asks for it.
