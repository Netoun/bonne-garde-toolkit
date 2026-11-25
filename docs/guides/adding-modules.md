# Adding modules and UI items

```bash
bunx bonne-garde list
```

```text
UI (29)
  ✓ alert          Callout with a title, a description and an optional action.
    alert-dialog   Modal dialog that asks for a decision, on the Base UI alert dialog.
    avatar         Image with a fallback, with a group, a count and a badge.
    badge          Status badge component.
    breadcrumb     Breadcrumb trail with separators and an ellipsis.
  ✓ button         Primary button component.
…
Blocks (2)
  ✓ spa-auth        Sign-in, sign-up, forgot and reset password and email verification pages for th…
    spa-backoffice  The signed-in shell of the SPA: a sidebar layout with an organization switcher,…
…
Modules
  pm
    ✓ pm/bun   Bun installs the project and runs its scripts: the root packageManager pin, and the…
      pm/pnpm  pnpm installs the project and Node runs its scripts: the root packageManager pin, pn…
…
  email
      email/resend  Transactional email: React templates for auth's verification and password reset…
  storage
      storage/fs  Media uploads over a directory under DATA_DIR: the medias table and the /v1/media…
      storage/r2  Media uploads over an R2 bucket: the BUCKET binding, the medias table and the /v1…
…

✓ installed · 57 entries · npx bonne-garde add <name>
```

Run it inside a project from [Getting started](./getting-started.md). The catalog has two kinds of entries. An **item** is one piece you copy into your code: a button, a form, a page. A **module** is a bigger piece that wires itself into the project: a database, auth, email. A module is named `<category>/<id>`, like `email/resend`. A `✓` marks what the project already has.

## Find something

Narrow the list to one category, or search by word:

```bash
bunx bonne-garde list --category storage
bunx bonne-garde search dialog
```

```text
Modules
  storage
      storage/fs  Media uploads over a directory under DATA_DIR: the medias table and the /v1/media…
      storage/r2  Media uploads over an R2 bucket: the BUCKET binding, the medias table and the /v1…

✓ installed · 2 entries · npx bonne-garde add <name>
UI (3)
    alert-dialog  Modal dialog that asks for a decision, on the Base UI alert dialog.
    dialog        Modal dialog, on the Base UI dialog.
    sheet         Side sheet, on the Base UI dialog.

✓ installed · 3 entries · npx bonne-garde add <name>
```

`view` shows what one item would put in your project before you add it:

```bash
bunx bonne-garde view badge
```

```text
badge  registry:ui
Status badge component.

Install  npx bonne-garde add badge

Files
  ui/badge.tsx → packages/ui/src/components/badge.tsx

Dependencies
  Needs       utils, animations
  Packages    class-variance-authority, motion
```

`Needs` lists the other items it builds on; `utils` and `animations` are already in the project, so nothing more is added. `Packages` are installed for you. The commands print their hints with `npx`; `bunx` does the same.

## Add a UI item

Add `--dry-run` first. It plans the add and writes nothing:

```bash
bunx bonne-garde add badge --dry-run
```

```text
┌   bonne-garde add
│
◇  Planned badge (1 item)
│
◇  Dry run: would write 1 file
│
◆  badge  would write 1 file
│    packages/ui/src/components/badge.tsx
│
●  Would install: class-variance-authority, motion
│
└  Nothing written. Run it again without --dry-run to apply.
```

If the plan looks right, run the same command without the flag:

```bash
bunx bonne-garde add badge
```

```text
┌   bonne-garde add
│
◇  Planned badge (1 item)
│
◇  Wrote 1 file
│
◇  Installed with bun in 0s
│
◆  badge  1 file
│    packages/ui/src/components/badge.tsx
│
●  Installed: class-variance-authority, motion
│
└  Done.
```

The file is yours from now on: edit it as you like. The CLI records its checksum in `bg.json`, so a later `add` can tell your edits from its own (see [the manifest](../MANIFEST.md)). Use `--no-install` to skip the package install.

## Add a module

A module adds many files, so the dry run is worth reading:

```bash
bunx bonne-garde add email/resend --dry-run
```

```text
┌   bonne-garde add
│
◇  Planned email/resend (1 module)
│
◇  Dry run: would write 21 files, apply 1 patch
│
◆  email/resend (better-auth)  would write 21 files · would apply 1 patch · packages/email
│    packages/email/package.json
│    packages/email/src/auth-mailer.test.ts
│    … 19 more under packages/email
│
●  Would install: @my-app/api-runtime, @my-app/config, @react-email/render, @types/react, react, react-dom
│
●  New in .env.example: RESEND_API_KEY
│
└  Nothing written. Run it again without --dry-run to apply.
```

A module writes its own package (`packages/email`), **patches** the files of the modules it plugs into (here, one line in auth's `package.json`), installs the packages it needs and lists the new variables in `.env.example`. A patch is a small, exact edit the CLI applies for you. Now apply it:

```bash
bunx bonne-garde add email/resend
```

```text
┌   bonne-garde add
│
◇  Planned email/resend (1 module)
│
◇  Wrote 21 files, applied 1 patch
│
◇  Installed with bun in 1s
│
◆  email/resend (better-auth)  21 files · 1 patch applied · packages/email
│    packages/email/package.json
│    packages/email/src/auth-mailer.test.ts
│    … 19 more under packages/email
│
●  Installed: @my-app/api-runtime, @my-app/config, @react-email/render, @types/react, react, react-dom
│
●  New in .env.example: RESEND_API_KEY

1 intention to apply
  • email/resend/wire-email-into-auth
  Hand .bg/add/session.md to your coding agent. Once it applied one, run:
    npx bonne-garde record <id>
    npx bonne-garde record <id> --skip "<reason>"

Checks, once the intentions are applied
  email/resend
    cd packages/email && bunx vp run typecheck && bunx vp run test
│
└  Done.
```

Two things are left for you. Set `RESEND_API_KEY` where the runtime reads its secrets (`apps/api/.dev.vars` locally).

The **intention** is an edit the CLI could not make for you: here, telling auth to send its emails through the new package. `.bg/add/session.md` is a checklist for a coding agent, and `.bg/add/01-wire-email-into-auth.md` says what to change and when to skip it. Do it by hand or hand the file to an agent. In this case the change is in `packages/auth/src/mailer.ts`: import `emailMailer` from `@my-app/email` and export it as `mailer`. Then tell the CLI:

```bash
bunx bonne-garde record email/resend/wire-email-into-auth
```

```text
recorded email/resend/wire-email-into-auth as applied in email/resend, and marked packages/auth/src/mailer.ts as edited by it
```

If you decide not to make the change, run the same command with `--skip "<reason>"`. Both answers are kept in `bg.json`. For how modules, patches and intentions fit together, read [Modules](../MODULES.md).

Storage works the same way. This project runs on Cloudflare, so the Cloudflare variant is `storage/r2`:

```bash
bunx bonne-garde add storage/r2
```

```text
┌   bonne-garde add
│
◇  Planned storage/r2 (1 module)
│
◇  Wrote 20 files, applied 6 patchs
│
◇  Installed with bun in 0s
│
◆  storage/r2 (cloudflare)  20 files · 6 patchs applied · packages/storage
│    packages/storage/package.json
│    packages/storage/src/bucket.test.ts
│    … 18 more under packages/storage
│
●  Installed: @cloudflare/workers-types, @elysiajs/eden, @my-app/api-runtime, @my-app/auth, @my-app/db, drizzle-orm, elysia, miniflare
│
●  New in .env.example: R2_PUBLIC_URL

Checks to run
  storage/r2
    cd packages/storage && bunx vp run typecheck && bunx vp run test
│
└  Done.
```

The CLI does not run the checks it lists. Run them yourself.

## When an add is refused

Some entries need another one first. The CLI says so before it writes anything, and exits with code 1. In a project with no UI package, adding a button fails and gives the command that works:

```bash
bunx bonne-garde add button
```

```text
┌   bonne-garde add
│
▲  Planning button: failed
└  button needs the ui module, and none is installed or named in this call; run: npx bonne-garde add ui/shadcn button
```

Run the command it prints. A module can also need a whole category. In a project with no provider (where the API runs), email has nowhere to run:

```bash
bunx bonne-garde add email/resend
```

```text
┌   bonne-garde add
│
▲  Planning email/resend: failed
└  email/resend needs a module in category provider (any) and none is installed
```

Add one first, for example `bunx bonne-garde add provider/cloudflare`, then try again. `bunx bonne-garde create --apps api` sets a provider up for you.

Some variants only fit one provider. `storage/fs` stores files on disk, which a Cloudflare Worker does not have:

```bash
bunx bonne-garde add storage/fs --dry-run
```

```text
┌   bonne-garde add
│
▲  Planning storage/fs: failed
└  storage/fs accepts only dockerfile for provider, but provider/cloudflare is present
```

Pick the variant that matches (`storage/r2` here). [Troubleshooting](./troubleshooting.md) lists the other refusals.

## Check the project

Run `doctor` after an add. Right after `email/resend`, with its intention still open:

```bash
bunx bonne-garde doctor
```

```text
bonne-garde doctor

✓ manifest    version 2, 12 modules, 9 items, 188 files
✓ files       188 tracked: 180 intact, 8 checked by region
✓ regions     49 regions in 10 files, 45 read
✓ patches     25 applied, 0 skipped, 0 failed
▲ intentions  0 applied, 0 skipped, 1 pending
    .bg/add/01-wire-email-into-auth.md: intention pending: apply it, then run bonne-garde record
✓ peers       12 modules checked, 0 not checked

1 warning
```

A warning does not fail the command, but it is a job left undone. After `record`, the same command reads:

```text
✓ intentions  1 applied, 0 skipped, 0 pending
…
All good.
```

`doctor --strict` exits with an error on any warning, which suits a CI job.

## Where to go next

- [Troubleshooting](./troubleshooting.md) when a command refuses.
- [Modules](../MODULES.md) for what a module is made of.
- [The CLI reference](../CLI.md) for every flag of `add`, `list` and `doctor`.
