# Getting started

```bash
bunx bonne-garde create my-app
```

```text
┌   bonne-garde create
│
◇  Created my-app: 1 module
│
◇  Installed with bun in 2s
│
◇  Next steps ─────────────────────────────╮
│                                          │
│  cd my-app                               │
│  bun run dev    every app, side by side  │
│  bun run test   every package's tests    │
│                                          │
├──────────────────────────────────────────╯
│
└  En garde.
```

That is a new project: an empty base, with Bun as its package manager, its dependencies installed and a git repository. It holds no app yet. Check it with `doctor`:

```bash
cd my-app
bunx bonne-garde doctor
```

```text
bonne-garde doctor

✓ manifest    version 2, 1 module, 0 items, 1 file
✓ files       1 tracked: 1 intact
✓ regions     1 region in 1 file, 1 read
✓ patches     1 applied, 0 skipped, 0 failed
✓ intentions  0 applied, 0 skipped, 0 pending
✓ peers       1 module checked, 0 not checked

All good.
```

`✓` on every line means what `bg.json` says is installed matches what is on disk. Run `doctor` again whenever something looks off.

## An API, a SPA, a database and auth

Say what you want with flags, and add `--yes` so the CLI does not ask:

```bash
bunx bonne-garde create my-app --apps api,spa --features db,auth --yes
```

```text
┌   bonne-garde create
│
◇  Created my-app: 10 modules, 8 items
│
◇  Installed with bun in 7s
│
◇  Next steps ─────────────────────────────╮
│                                          │
│  cd my-app                               │
│  bun run dev    every app, side by side  │
│  bun run test   every package's tests    │
│                                          │
├──────────────────────────────────────────╯
│
└  En garde.
```

`--apps` picks the apps (`api`, `spa`, `ssr`, `static`) and `--features` picks what they use (`db`, `auth`, `storage`, `email`, `deploy`, `backoffice`, `portless`). Run `bunx bonne-garde create --help` for the full list. Without `--yes`, on a terminal, the CLI asks the questions the flags leave open.

The CLI does not run the checks of what it installed. Run them yourself, from the project root:

```bash
bun run typecheck
bun run test
```

```text
…
[@my-app/db#test]  Test Files  5 passed (5)
[@my-app/db#test]       Tests  22 passed (22)
…
[@my-app/auth#test]  Test Files  11 passed (11)
[@my-app/auth#test]       Tests  53 passed (53)
…
vp run: 0/6 cache hit (0%). (Run `vp run --last-details` for full details)
```

Both exit with code 0. `bun install` already ran during `create`; run it again only after you edit a `package.json` by hand.

## Set the auth secret

The auth module needs a secret before the API starts. Generate one:

```bash
bun run --filter @my-app/auth auth:secret
```

```text
@my-app/auth auth:secret: Add the following to your .env file:
@my-app/auth auth:secret: # Auth Secret
@my-app/auth auth:secret: BETTER_AUTH_SECRET=6e33…
@my-app/auth auth:secret: Exited with code 0
```

Put the `BETTER_AUTH_SECRET=…` line in `apps/api/.dev.vars`, the file Wrangler reads for local secrets. Git ignores it. `.env.example` at the root lists the variables the project expects.

## Run it

```bash
bun run dev
```

This starts every app that has a `dev` script. The API listens on <http://localhost:5172> and the SPA on <http://localhost:5173>.

## What is in the project

```text
my-app/
├── bg.json        what is installed, and the checksum of every file written
├── apps/
│   ├── api/       the API (Elysia, on Cloudflare Workers)
│   └── spa/       the web app (React Router)
├── packages/
│   ├── api-runtime/   where the API runs; swapped when you change provider
│   ├── auth/      sign-in
│   ├── config/    names and branding shared by the apps
│   ├── db/        the database schema and migrations
│   └── ui/        the UI components
├── AGENTS.md      rules for a coding agent working in the project
└── package.json   scripts: dev, build, typecheck, test, check
```

- **`bg.json`** is the project's record. The CLI reads it to know what is installed and to tell your edits from its own files. You should not edit it by hand. See [the manifest](../MANIFEST.md).
- **`apps/`** holds what you deploy. **`packages/`** holds what the apps share. The files are yours: edit them freely.

## Where to go next

- [Adding modules and UI items](./adding-modules.md) to an existing project.
- [Troubleshooting](./troubleshooting.md) when a command refuses.
- [Concepts](../CONCEPTS.md) for the words the CLI uses: module, item, category, peer.
- [The CLI reference](../CLI.md) for every command and flag.
