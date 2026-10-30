# db/d1

The database binding of a Cloudflare Worker: the D1 binding `DB` in `apps/api`'s `wrangler.jsonc`,
the scripts that apply migrations to it, and the typed handle code reads it through. `packages/db`
is shared with [`orm/drizzle`](../../orm/drizzle/README.md): this module owns the package, the ORM
adds to it.

```bash
bunx bg add provider/cloudflare db/d1
```

## Peers and variant

| Peer       | Allow-list   | Why                                                                              |
| ---------- | ------------ | -------------------------------------------------------------------------------- |
| `provider` | `cloudflare` | `src/d1.ts` imports `readRuntimeEnv` from `{{SCOPE}}/api-runtime`, which it owns |

035 asks a `db` module for one variant per provider it supports. D1 is Cloudflare's, so there is one,
`cloudflare`, matched on `provider: cloudflare`. A project on the `dockerfile` provider is refused
(`db/d1 accepts only cloudflare for provider`); a database for it is a module of its own.

## What it writes

Everything in `packages/db`, which 035 gives to `db` and `orm` together:

| File                 | What it is                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `package.json`       | `{{SCOPE}}/db`: the `./d1` export and the `typecheck` and `test` scripts; the maps below  |
| `tsconfig.json`      | extends the project's; `bun` types, and the Workers types through `src/d1.ts`'s reference |
| `tsconfig.test.json` | the same, with the tests                                                                  |
| `src/d1.ts`          | `D1_BINDING`, `bindD1(env)` and `readD1()`                                                |
| `src/d1.test.ts`     | five tests: one against a real D1 (Miniflare), four on the path with no binding           |

It declares `{{SCOPE}}/api-runtime` (`workspace:*`), and `@cloudflare/workers-types` and `miniflare`
as dev dependencies, pinned. `miniflare` runs the tests' D1: workerd with an in-memory SQLite, the
database Cloudflare runs, not a stand-in.

## The handle

`readD1()` gives the binding of the runtime the code runs on, read through the provider's
`readRuntimeEnv` so that nothing here names `cloudflare:workers`. Where there is no binding, under
`bun test` or `bun run`, it gives a database that throws on first use with a message naming `DB` and
`bun run dev`. That is deliberate: the API shell's own tests, and every route that does not query,
load and answer without a database, and the route that does says what is missing. A string that
happens to be named `DB` in `process.env` is not taken for a binding.

`bindD1(env)` is the same over a record you hand it, which is what the tests do with a real D1.

## Patches (060)

| Type            | File                      | Regions                                                            |
| --------------- | ------------------------- | ------------------------------------------------------------------ |
| `jsonc.merge`   | `apps/api/wrangler.jsonc` | `d1_databases`, `env.production.d1_databases` (an array is a leaf) |
| `scripts.merge` | `apps/api/package.json`   | `scripts.db:migrate:local`, `scripts.db:migrate:remote`            |

Both entries have `binding: "DB"`, `database_name: "my-app-db"`, `database_id` of zeros and
`migrations_dir: "../../packages/db/migrations"`, which is where `orm/drizzle`'s `db:generate` writes.
Wrangler does not inherit `d1_databases` into an environment, hence two. **Replace the name and
the id** with `bunx wrangler d1 create <name>` before a deploy; locally they only name the state under
`apps/api/.wrangler`. The scripts address the database by its binding, so renaming it breaks nothing:

```bash
cd apps/api && bun run db:migrate:local   # wrangler d1 migrations apply DB --local
```

Without `apps/api` (`api/elysia`), both patches fail and become pending intentions (060), not a
failed install.

## Not here

- **The Drizzle client, `db.service` and `db.module`** of the legacy `apps/api/src/modules/db`. All
  three name `DB = DrizzleD1Database<typeof schema>`, which needs the schema barrel, and `orm` comes
  after `db` in 035's order. They are `orm/drizzle`'s.
- **`DB` in the shell's `Env`.** Nothing reads it there once `readD1()` owns the binding, and no patch in
  060's catalog writes an interface member.
- **Wiring into `apps/api/src/app.ts`.** See `orm/drizzle`.
