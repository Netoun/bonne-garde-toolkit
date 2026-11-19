# Changelog

One lockstep version for the CLI, the base template, the registry and the migration intentions ([RELEASE.md](./docs/RELEASE.md)).

## 0.3.0

`bonne-garde` and `@bonne-garde/{cli,registry,schema}`: 0.2.0 → 0.3.0.

### CLI

- `create --features db` picks `db/libsql` on the `dockerfile` provider (`db/d1` stays the `cloudflare` one). `db/postgres` is reached with `bonne-garde add db/postgres orm/drizzle`.
- The base template's `.gitignore` ignores `.data/`, where `db/libsql` keeps its SQLite file in dev.

### Modules

- `db/libsql`: a SQLite file under `DATA_DIR`, opened once per process through libsql, in `packages/db`. It is the database of `provider/dockerfile`.
- `db/postgres`: a postgres-js client over `DATABASE_URL`, and a `compose.postgres.yaml` that starts a local Postgres (`vp run db:up`). It is for `provider/dockerfile`, and a project has one `db` module.
- `orm/drizzle`: a `libsql` variant over `db/libsql` and a `postgres` variant over `db/postgres`, each with its Drizzle client, its `dbModule` plugin and its test database.
- `provider/dockerfile` has a database now: sign-up and sign-in run on `db/libsql` or `db/postgres`. Object storage is still missing.

### Fixes

- None.

### Docs

- The specs and the dated plans are gone: five light docs (concepts, modules, manifest, CLI, release) and eight ADRs replace them.

### Intentions

- None added: this release has no migration. A new module changes no project that does not add it, and a project made with 0.2.0 has no `db/libsql`, so the `.data/` line asks nothing of it (one that adds `db/libsql` later adds `.data/` to its `.gitignore` itself). `email/resend/wire-email-into-auth` is unchanged (its wording lost a reference to the deleted specs).

## 0.2.0

`bonne-garde` and `@bonne-garde/{cli,registry,schema}`: 0.1.0 → 0.2.0.

### CLI

- `bonne-garde create` asks for the package manager, the apps, the provider and the features (`--pm`, `--apps`, `--provider`, `--features`), and checks the set against the registry before it writes a file.
- A terminal view for `create` and `add`: menus, spinners, the intentions to hand to an agent, the next steps. `add` prints a summary on a terminal, and the same JSON as before to a pipe or under `--json`.
- The project installs with the package manager its `package.json` pins; a missing one is one line, and the files stay written.

### Modules

- New category `pm`, first in the table: `pm/bun`, `pm/pnpm`.
- `web/spa`, `web/ssr` and `web/static` install without the API.
- `provider/dockerfile`: one Node container for either package manager; it serves the SPA alone when the project has no API.
- Every module tests on Vitest and runs its scripts with tsx, on Node as on Bun.

### Fixes

- `--help` and `-h` print the usage whatever the command; `create` refuses an option it does not know instead of creating a directory named after it.
- `create --registry local:<relative path>` reads the path from where it runs, and the project records it absolute.
- `web/spa`: the loader no longer stays up for good under StrictMode in dev, and the `dark` class the theme store sets before hydration no longer warns.

### Intentions

- None added. `email/resend/wire-email-into-auth` is unchanged.
