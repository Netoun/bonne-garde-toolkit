# Troubleshooting

```bash
bunx bonne-garde add button
```

```text
┌   bonne-garde add
└  Not a Bonne Garde project
   No bg.json in …/empty.
   Create one: bonne-garde create <dir>
```

The command ran in a folder that is not a project, so it stopped and exited with code 1. Every error of the CLI has the same three parts: what went wrong, the cause, and the command that fixes it. Read the last line first. This page shows the errors you are most likely to meet, each with the real output and the way out.

A Bonne Garde project is a folder with a `bg.json` at its root. `cd` into your project, or [create one](./getting-started.md).

## It does not know that name

A typo in a command or a flag gets the nearest match:

```bash
bunx bonne-garde lst
```

```text
✖ Unknown command: lst
  Did you mean: list?
  All commands: bonne-garde --help
```

```bash
bunx bonne-garde add --itmes
```

```text
✖ Unknown flag: --itmes
  All flags: bonne-garde add --help
```

The same goes for the name of an item or a module:

```bash
bunx bonne-garde add buton
```

```text
┌   bonne-garde add
│
▲  Planning buton: failed
└  unknown name: buton (did you mean: button?)
```

When nothing is close enough, there is no suggestion. Search the catalog by word instead: `bunx bonne-garde search <word>` prints `No match for "<word>"` when nothing fits, and the list of matches when something does. See [Adding modules and UI items](./adding-modules.md#find-something).

## A category is already filled

A project has one database, one provider, one storage. This project already runs D1, so a second database is refused:

```bash
bunx bonne-garde add db/postgres
```

```text
┌   bonne-garde add
│
▲  Planning db/postgres: failed
└  db is already filled by db/d1. A project has one db module, and replace is not available yet. Nothing was written.
```

Nothing is written when an add is refused, so there is nothing to undo. Keep the module you have, or start a new project with the one you want: `bunx bonne-garde create my-app --apps api --features db` sets one up. Swapping a module in place is not available yet.

## A module needs another one

Some modules plug into another module and cannot work without it. `storage/r2` stores the uploads of a signed-in user, so it needs auth:

```bash
bunx bonne-garde add storage/r2
```

```text
┌   bonne-garde add
│
▲  Planning storage/r2: failed
└  storage/r2 needs a module in category auth (better-auth) and none is installed
```

The message names the category and, in brackets, the variant that fits. Name the missing module in the same call, and check the plan first:

```bash
bunx bonne-garde add auth/better-auth storage/r2 --dry-run
```

```text
┌   bonne-garde add
│
◇  Planned auth/better-auth, storage/r2 (2 modules)
│
◇  Dry run: would write 46 files, apply 11 patchs
│
◆  auth/better-auth (d1)  would write 26 files · would apply 5 patchs · packages/auth
│    packages/auth/package.json
│    packages/auth/src/auth.cli.test.ts
│    … 24 more under packages/auth
│
◆  storage/r2 (cloudflare)  would write 20 files · would apply 6 patchs · packages/storage
│    packages/storage/package.json
│    packages/storage/src/bucket.test.ts
│    … 18 more under packages/storage
│
●  Would install: @app2/api, @app2/api-runtime, @app2/auth, @app2/db, @better-auth/drizzle-adapter, @cloudflare/workers-types, @elysiajs/eden, auth and 4 more
│
●  New in .env.example: BETTER_AUTH_SECRET, R2_PUBLIC_URL
│
└  Nothing written. Run it again without --dry-run to apply.
```

When the missing piece is a whole category, like a provider, the message says `(any)`, and any module of that category will do. See [Modules](../MODULES.md) for how modules depend on each other.

## A file you changed is in the way

Say you edited `packages/ui/src/components/button.tsx` and run `add button` again. The CLI will not overwrite your work:

```bash
bunx bonne-garde add button
```

```text
┌   bonne-garde add
│
◇  Planned button (1 item)
│
▲  Writing files: failed
└  collision at packages/ui/src/components/button.tsx (use --force to overwrite)
```

Your edit stays on disk. To keep it, do nothing. To drop it and get the registry version back, repeat the command with `--force`:

```bash
bunx bonne-garde add button --force
```

```text
┌   bonne-garde add
│
◇  Planned button (1 item)
│
◇  Wrote 1 file
│
◇  Installed with bun in 39s
│
◆  button  1 file
│    packages/ui/src/components/button.tsx
│
●  Installed: @base-ui/react, class-variance-authority, motion, react
│
└  Done.
```

`--force` only reaches the items and modules you name in that call. It does not touch the others. The CLI knows which files you edited from the checksums it keeps in `bg.json` (see [the manifest](../MANIFEST.md)). Commit your work before a `--force`, so `git diff` shows what changed.

## The package manager is not installed

A project pins its package manager (`bun` or `pnpm`) in its `package.json`. If that program is missing, the CLI still writes the files, then says what is left to do:

```bash
bunx bonne-garde add ui/shadcn button
```

```text
┌   bonne-garde add
│
◇  Planned ui/shadcn, button (1 module, 3 items)
│
◇  Wrote 9 files
│
▲  Installing 12 packages with bun: failed
│
◆  ui/shadcn (default)  6 files · packages/ui
│    packages/ui/components.json
│    packages/ui/package.json
│    … 4 more under packages/ui
│
◆  button  + 2 it needs: utils, animations
│    packages/ui/src/lib/utils.ts
│    packages/ui/src/lib/animations.ts
│    … 1 more under packages/ui/src/components
│
●  To install: @base-ui/react, @types/react, class-variance-authority, clsx, lucide-react, motion, react, react-dom and 4 more

Checks to run
  ui/shadcn
    bunx vp run typecheck
└  bun is not installed, and the project's package.json pins it: the files are written; install bun, then run `bun install` in the project
```

The command exits with code 1, but the add itself worked. Install the program named in the message, then run its `install` in the project. There is nothing to add again.

## What doctor tells you

`doctor` compares `bg.json` with what is on disk. A warning is a divergence the CLI keeps and reports, never one it fixes on its own. A plain `doctor` exits with 0 on a warning; `doctor --strict` exits with 1, which suits a CI job. An error always exits with 1.

After the `--force` section above, you edit the file again, and `doctor` says:

```bash
bunx bonne-garde doctor
```

```text
bonne-garde doctor

✓ manifest    version 2, 8 modules, 3 items, 77 files
▲ files       77 tracked: 72 intact, 1 user-modified, 4 checked by region
    packages/ui/src/components/button.tsx: edited by you: keep it, or run add --force to overwrite
✓ regions     21 regions in 5 files, 21 read
✓ patches     11 applied, 0 skipped, 0 failed
✓ intentions  0 applied, 0 skipped, 0 pending
✓ peers       8 modules checked, 0 not checked

1 warning
```

```bash
bunx bonne-garde doctor --strict
```

The same report, and the exit code is 1.

| Line         | The warning means                                                                          | What to do                                                                            |
| ------------ | ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `files`      | You edited a file the CLI wrote.                                                           | Nothing, it is yours. Run `add <name> --force` only to get the registry version back. |
| `regions`    | You edited a line a module patched into a shared file, such as a script of `package.json`. | Same: keep it, or `add --force` to restore it.                                        |
| `intentions` | A change the CLI could not make alone is waiting for you.                                  | Apply it, then `record` it (below).                                                   |

The `regions` warning looks like this, after changing the `dev` script of `apps/api/package.json`:

```text
✓ files       77 tracked: 73 intact, 4 checked by region
▲ regions     21 regions in 5 files, 21 read
    apps/api/package.json: region edited by you: keep it, or run add --force to overwrite
```

An **intention** is a change written as instructions, for a file the CLI cannot patch safely. `add email/resend` leaves one when it plugs into auth, and says so at the end of its output:

```text
1 intention to apply
  • email/resend/wire-email-into-auth
  Hand .bg/add/session.md to your coding agent. Once it applied one, run:
    npx bonne-garde record <id>
    npx bonne-garde record <id> --skip "<reason>"
```

Until it is recorded, `doctor` keeps the warning:

```text
▲ intentions  0 applied, 0 skipped, 1 pending
    .bg/add/01-wire-email-into-auth.md: intention pending: apply it, then run bonne-garde record
```

Make the change by hand or with a coding agent, then run `bunx bonne-garde record email/resend/wire-email-into-auth`. If you decide not to, add `--skip "<reason>"`. Either answer ends the warning. See [Adding modules and UI items](./adding-modules.md#add-a-module).

Other warnings have the same shape: one line with the file and a hint. A `patches` or `peers` line that is not `✓` names the module and the file to look at. For the full list of checks, read [the CLI reference](../CLI.md).
