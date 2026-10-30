# 07 — Handoff: where to pick up

Written 2026-10-29 at `HEAD` of `feat/platform-cli-registry`; updated 2026-10-30 at `833d2ef`. Read
this, then [09-dissolution.md](./09-dissolution.md). [06-platform-gaps.md](./06-platform-gaps.md)
holds the argument for the legacy dissolution; 09 corrects its order to spec 080's.

## Start here

**Every step of [08-plan.md](./08-plan.md) is done (2026-10-30): P1, P2, A1–A3, B1–B4 and C1, and
the first two of its "Next steps".** What is left is the legacy dissolution. 08's "Next steps" has
the detail; in this order:

1. **Complete the `spa-react-router` registry item.** **Done** (`2cce2f8`, `9e35a15`, `f56fab1`).
   Golden installs 8 items and runs `build`, so it now covers missing `exports` subpaths: removing
   `./components/*` from `registry/ui/package.json` fails it at typecheck, and the same break went
   green at `fcea043`. CI run 41043145162 is green.
2. **A module install path in `bg add`.** **Done** (`5aa660e`, `588aa53`, `befac8a`, `9e725ad`,
   `28296b5`, `833d2ef`). `bg add` installs a `module.json` module; see "What exists now". CI run
   41044930659 is green.
3. **Installing from a `github:` source.** **Done** (`2eea6a5`, `6a86bc0`); the user put it ahead
   of the dissolution. A real consumer still needs a tagged release; see the loose ends.
4. **The legacy dissolution, in 080's order, not smallest-first.** The plan is
   [09-dissolution.md](./09-dissolution.md). **Stages 1 (`tooling`, `0c862a2`) and 2 (`ui`, `daf604f`) are done.** The scope-dependent formatting bug they exposed is fixed (`797fae7`). Stage 3 is in progress: commits 1–2 (`config/branding`, `scripts.merge`) are done at `2b2a45f`. `config` moved to the start of stage 3 in 080: an item cannot depend on a module, and `spa-react-router` pulls `config` until `web/spa` replaces it. The
   questions at its end are answered; see the settled list below.

The diagnosis this file first gave for P1 was wrong. It blamed the Bun version for
`error: lockfile had changes, but lockfile is frozen`; in fact `--frozen-lockfile` failed under
1.4.2 as well, because `bun.lock` had never been re-locked after the `apps/cli` → `packages/cli`
move. Bun 1.3.11 accepts the re-locked file. A second, unrelated cause then stopped the image in
the SPA prerender (`ECONNREFUSED 127.0.0.1`, Debian's `::1`-first `localhost`). `docker build` of
the dockerfile template now completes; the build recipe is in that module's README.

CI on #16 is green since P1 (run 41030795565, Bun 1.4.2): the first run past install, and the two
`media.routes` tests that failed under 1.3.11 pass. It stayed green through the rest: `783d331`
(run 41035969379), `f162f10` (run 41038194932) and `a47036e` (run 41039492663). That run is the
first with the `bun run golden` step, which took 1.3s in total in CI. Since then `f56fab1` (run 41043145162) and `833d2ef` (run 41044930659) are green too.

## State of the branch

The table lists the platform commits in order; the last twenty-five, `af4352d` to `833d2ef`, are
B1–B4, A1–A3 and C1, then the spa item and the module install, in commit order
(`git log --oneline 83523b3..HEAD`; `30b6183` and `fcea043` are plan updates and not listed). `bun install --frozen-lockfile && bun run verify`
is green in CI, followed by `bun run golden`. `verify` is `vp check`, typecheck (platform +
legacy), the tests, intentions lint, registry build and the builds. Before the P1 re-lock, `verify`
was only green on a warm local `node_modules`; CI never got past install.

| Commit    | What                                                                                                          |
| --------- | ------------------------------------------------------------------------------------------------------------- |
| `cdab424` | Renamed the platform slug to `bonne-garde-toolkit`; deduped `DEFAULT_PLATFORM_REMOTE` into `packages/schema`  |
| `9902a33` | Merged `main` (8 conflicts); CI became one job, `bun install --frozen-lockfile && bun run verify`             |
| `7e99cc2` | Added `"./lib/*"` to `apps/api`'s `exports`                                                                   |
| `96aa898` | Moved the CLI from `apps/cli` to `packages/cli`                                                               |
| `0728ef9` | Planned the providers and reordered 06 behind them                                                            |
| `b53b499` | Added the `provider` category to spec 035                                                                     |
| `bcf680e` | Lifted the runtime env read out of `app.config.ts`                                                            |
| `0252837` | `parseModuleManifest`, the module contract test, and the two provider modules                                 |
| `f7c17c1` | P1: re-locked `bun.lock` after the CLI move — the actual CI fix                                               |
| `375c4dd` | P1: pinned Bun 1.4.2 at all four sites — alignment only                                                       |
| `59b79fa` | P1: `ipv4first` in the dockerfile build stage; `docker build` completes                                       |
| `f8c826f` | P2: `templates/base` up to spec 010 — `.bg/`, Vite+ `check`, empty-workspace `typecheck`/`test`               |
| `af4352d` | B1: `bg.json` v2; a v1 manifest is read and rewritten with a stated message                                   |
| `c2ac047` | B2: `add` records the sha256 and owner of every file; not `regions`, `modules` or `apps` (nothing makes them) |
| `aad1c96` | A1: spec 035 lets an app-homed module write a thin entry under `apps/<id>/src`                                |
| `783d331` | A1: `packages/api-runtime`; `apps/api/src/index.ts` is `export default serve(app)`                            |
| `ea28156` | `bg add --yes` is accepted instead of being read as an item name                                              |
| `8a3962f` | `bg create` names the project after the directory's basename; also fixes `bg create .`                        |
| `ce46708` | B3: `bg doctor`                                                                                               |
| `f162f10` | B4: `bg record`                                                                                               |
| `177c690` | C1: `bun run golden`                                                                                          |
| `9ee6dd0` | C1: CI runs the golden project after `verify`                                                                 |
| `5c931d3` | C1: golden failure messages name `bun`, not its resolved path                                                 |
| `a7fdc85` | C1: `bun run golden` listed in `AGENTS.md` and `docs/COMMANDS.md`                                             |
| `c26ffb6` | C1: `docs/TESTING.md` says CI also runs the golden project                                                    |
| `75e91fd` | A2: the dockerfile variant of `@acme/api-runtime`                                                             |
| `a47036e` | A3: the dockerfile module README, written after the container was built and observed                          |
| `e4a94e1` | Specs 090 and the intention template name the command `bg record`                                             |
| `2cce2f8` | Next step 1: `spa-react-router` vendors every file it needs                                                   |
| `9e35a15` | Next step 1: golden installs `spa-react-router` with the other items                                          |
| `f56fab1` | Next step 1: golden builds the generated project                                                              |
| `5aa660e` | Next step 2: the schema keeps the `module.json` fields `add` must act on                                      |
| `588aa53` | Next step 2: item apply is all-or-nothing                                                                     |
| `befac8a` | Next step 2: plan a module install (050 steps 3 to 8)                                                         |
| `9e725ad` | Next step 2: apply a module install and record it (050 steps 10 to 12)                                        |
| `28296b5` | Next step 2: `bg add` installs a module                                                                       |
| `833d2ef` | Next step 2: the provider READMEs say what `bg add` does with them                                            |

## What the plan covered, and what it left

**The ordered, per-step plan with acceptance criteria is [08-plan.md](./08-plan.md).** Each step
there opens with a **Done** line; where a premise or an instruction turned out wrong, the original is
kept for the record. What follows is only the shape of it, so this file stands alone.

Two shared prerequisites, then two independent tracks, then one step that needed both. All done:

|             |                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1**      | **Done** (`f7c17c1`, `375c4dd`, `59b79fa`). Re-locked `bun.lock` (the real CI fix), pinned Bun 1.4.2, and `docker build` completes.                                    |
| **P2**      | **Done** (`f8c826f`); the `bg.json` v2 row landed with B1 (`af4352d`). Two more gaps found and fixed than planned.                                                     |
| **Track A** | **Done.** A1 `aad1c96` and `783d331`, A2 `75e91fd`, A3 `a47036e`. The dockerfile provider runs; it has no database and no media storage.                               |
| **Track B** | **Done.** B1 `af4352d`, B2 `c2ac047`, B3 `ce46708`, B4 `f162f10`. `add` then recorded files only; since `9e725ad` it also records modules, and `regions` for env keys. |
| **Then**    | **Done.** C1 `177c690` and `9ee6dd0`. It covered less than planned; `2cce2f8` to `f56fab1` closed the `exports` gap. The Bun pin is still not caught.                  |

### Three findings that reshaped the plan on 2026-10-29

All three are resolved since: the first by B2 (`c2ac047`, for files only), the second by A1
(`aad1c96`), the third by P2 (`f8c826f`) and B1 (`af4352d`). The text below is what was found, as
written.

**`add` records nothing for `doctor` to read.** Earlier drafts of 06 and of this file said `bg add`
writes a sha256 per file and a region per patch, and that only `doctor` was missing. That was
wrong. `git grep -n "sha256\|regions\|createHash" -- packages` returns **nothing**;
`apply-plan.ts` writes `installed[name] = { source, version, installedAt }` and stops there. Spec
050's `add` algorithm step 12 is unimplemented, so the gap is two commands wide. That is step B2,
and it did not exist in the plan before.

**Spec 035 forbids the thing the `api` category needs.** The seam rule says a module MUST NOT write
module source into `apps/*/src`. Read literally, the app-homed `api` and `web` categories can ship
nothing at all. The rule's own reason — a module owning files in an app's `src` cannot be swapped —
points at the fix: amend 035 so an app-homed module MAY write a thin entry under `apps/<id>/src`
whose only content is an import from its package, and nothing else. One sentence, and it unblocks
Track A. The recommendation is in 08 step A1.

**`templates/base` breaks three MUSTs of spec 010.** Its `bg.json` is `version: 1` with `installed`
and `capabilities` where 010 requires `version: 2` with empty `modules`/`items`/`files`/`regions`;
its `_gitignore` ignores `bg.upgrade/`, a name no spec uses any more (`.bg/` is the scratch root in
010, 050, 065 and 090); and its `check` script is `echo "no check configured yet"` with no `fmt` or
`lint` beside it. The golden project is built from this template, so each gap would surface there.

## What exists now, as observed

**`bg doctor`** (`packages/cli/src/doctor.ts`) runs the six checks of spec 050: manifest, files,
regions, patches, intentions, peers. An _error_ is a record that contradicts the tree — a recorded
file is missing, a region's owner is not installed, a peer category is empty, `bg.json` is invalid —
and exits 1. A _warning_ is a divergence to keep — a user-modified file, a failed patch, a pending
or unreadable staged intention, a v1 `bg.json` — and exits 1 only with `--strict`. An unknown flag
exits 1. An intention is pending when an `NN-slug.md` under `.bg/add/` or `.bg/upgrade/` has a
frontmatter id that `bg.json` does not record. It checks only the paths `bg.json` records: an
unrecorded file is not drift (`untrackedButExpected` is always `[]`).

**The dockerfile provider** (`registry/modules/provider/dockerfile/`; its README was rewritten at
`a47036e` after the container was observed). What works: `docker build`, then `docker run` or
`compose up`, reaches healthy; `/health`, `/`, the built assets, the deep-link SPA fallback,
`/openapi` and `/auth/get-session` answer; the secret is generated under `DATA_DIR/secrets` and is
stable across a restart; `docker stop` takes 0.12s. What does not:

- No database: `config.DB` is undefined, so sign-up and sign-in return 500.
- No media storage: `BUCKET_NOT_CONFIGURED`.
- `RESEND_API_KEY` is required; without it the process exits at import.
- The SPA's `/auth/*` routes collide with Better Auth's `basePath`, `/auth`, so the link in the
  verification email lands on 401 JSON.
- `VITE_API_URL` is baked in at build time; a different origin means a rebuild.
- Better Auth's rate limit cannot see the client IP.
- `/android-chrome-192x192.png` returns 404.
- SIGTERM calls `process.exit(0)`; it will need a graceful close once a database exists.

The variant's tests run in `verify` through `test:scripts` (`bun test ./scripts ./registry/modules`:
explicit paths, not the bare sweep spec 070 forbids), but its code is typechecked only inside the
image. The dockerfile module overwrites `packages/api-runtime`, and the cloudflare module ships no
copy of its own, so swapping back has nothing to restore.

**`bg add` of a module** (`packages/registry/src/{module-plan,stage-module}.ts`; `5aa660e` to
`833d2ef`). `<category>/<id>` is always a module; a bare name is one when it is exactly one of an
item or a module, and an ambiguous bare name fails closed. Peers, cardinality and variant selection
follow 035. Tier 1 is copied with `{{SCOPE}}` rendered; a variant's `dependencies` become a generated
`package.json` in its `workspace`; env keys are merged into the root `.env.example`, never
overwritten, and recorded as `regions[".env.example"][KEY]`. The module record lands under
`modules` with its `files`, `bg.json` is written last, and item and module apply are all-or-nothing.
It refuses instead of skipping: a variant that declares `patch` or `intent`, `--set`, `remove` and
`replace`. `checks` are printed, not run; `consumesPackages` is ignored; `apps` is not written. Two
modules exist to install, the providers, and `provider/cloudflare` collides with `api-elysia` on
`apps/api/wrangler.jsonc`: see 09 (c) and (d).

**The golden project** (`scripts/golden-project.ts`, `bun run golden`) packs the CLI, copies the
pack outside the repo, and runs `bg create`, `bg add`, `bun install`, typecheck, test, `build` and
`bg doctor --strict` there. The copy matters: a pack run in place silently falls back to the repo's
`templates/base` through `packages/cli/src/paths.ts`, so a pack that dropped its templates would
still pass. It installs 8 items, every one `bg list` prints: `utils button badge card api-elysia
config portless spa-react-router`. It covers missing `exports` subpaths and the `apps/cli` →
`packages/cli` path churn class, through the pack's import rewriting. It does not cover the Bun pin:
`packageManager: bun@9.9.9` still installs. And it installs no module: `bg list` prints items only,
so the module path of `bg add` is covered by unit tests alone. 09 adds modules to golden in stage 1.

## Decisions waiting on the user

None.

## Things already settled — do not re-litigate

- **The GitHub repo is `Netoun/bonne-garde-toolkit`** (renamed 2026-10-30), and `origin` points
  there. The local folder is still `bonne-garde-boilerplate`; renaming it orphans
  `~/.claude/projects/-Users-nicolqs-Workspace-bonne-garde-boilerplate/`.
- **The legacy apps are dissolved into registry modules, in 080's order** (go given 2026-10-30), not
  smallest-first. The plan is [09](./09-dissolution.md). A legacy source is deleted only once golden
  is green for the module that replaces it; `apps/api` goes last.
- **`docs/plans/` stays in git** (2026-10-30). 07 and 08 are how one session hands off to the next,
  and this list keeps decisions from being re-litigated. None of it is normative. When the first
  platform release is tagged, move what is still true into `docs/specs/` or `AGENTS.md`, then delete
  the folder.
- **No `EMAIL` binding** (2026-10-30). Email goes through Resend, which is plain HTTP and works under
  both providers, so AGENTS.md's "no Cloudflare proprietary API outside `DB` / `BUCKET`" stands.
  Cloudflare's `send_email`, which `batch` and `treashunt` use, would come back only as a variant of
  a future `email` module with `peers.provider: ["cloudflare"]`, and would amend AGENTS.md in the
  same change. This unblocks 09's stage 5.
- **`bg record`, not `bg upgrade record`** (2026-10-30, `e4a94e1`). The command records install
  intentions as well as release ones, so it is top-level.
- **`add` fails on a user-modified file; `upgrade` keeps it** (2026-10-30, `ee1dbac`). `add`
  installs a module whole, so keeping the user's file would record a module as installed without it.
  060's conflict table now says so, matching 050's Errors table.
- **`--force` takes over a file another owner recorded**, and reports it as `tookOver` (2026-10-30,
  `ee1dbac`). It is explicit and reported.
- **Installing from `github:` came before the dissolution** (2026-10-30, `2eea6a5`, `6a86bc0`).
- **The seven questions of [09](./09-dissolution.md) §5 are answered: every recommendation accepted as written** (2026-10-30, specs `627dc3e`). `config` and `dev` are 035 categories; feature items live in `registry/features` and need `auth`; four 035 rules: a vendored `package.json` carries no dependency maps and the planner merges the variant's, a variant selects among files at distinct paths (per-provider content at one path goes to the provider or to one module per implementation), the provider owns `packages/api-runtime`, and `web` declares `peers.provider`; a file with recorded regions is checked by region, not by sha; `packages/ui` is not restructured at step 2; `web/ssr` needs the `cloudflare` provider.

- **`bg doctor` checks only the paths `bg.json` records.** A file `bg.json` does not record is the
  consumer's own code, not drift. This settles 06's unresolved question 1, decided in B3
  (`ce46708`); `untrackedButExpected` is always `[]`.
- **Elysia 2: no.** The blocker is Eden, not Elysia. `@elysiajs/eden@latest` is 1.4.9, peers
  `elysia >= 1.4.19`, and has no 2.x line; `@elysiajs/openapi` on 2.x exists only as
  `2.0.0-exp.0`. See [04-deps-plan.md](./04-deps-plan.md) for the three re-evaluation conditions.
- **Lockstep versioning, not per-item versions.** Spec 070 §"Lockstep versioning" is normative:
  one semver, one annotated tag, five surfaces. A module's own `version` is informational
  (070 line 58). `apply-plan.ts` already records `platform.version` per installed item.
- **`dockerfile` ships on libsql/SQLite, not Postgres.** Keeper went PGlite/PostgreSQL, but it
  chose that long before its Docker change; it says nothing about this toolkit's dialect. Postgres
  would move Drizzle off sqlite and drag `db.config.ts`, every migration and the real-SQLite test
  helpers with it. It belongs in a separate `db` module.
- **`email` is not provider-matched.** Resend is plain HTTP and works under both providers. SMTP is
  the provider-bound one, because Workers has no plain TCP outside Cloudflare's `connect()`. So a
  future `smtp` module declares `peers.provider: ["dockerfile"]` rather than `email` owing one
  variant per provider.
- **`bun test ./scripts`, not `bun test scripts`.** The bare form is a substring match that also
  sweeps `registry/` and `templates/`, which spec 070 forbids.
- **Front-end tests stay.** Four files, nine tests, arrived with `main`'s `4b329e8`; keeping them
  was confirmed on 2026-10-29. This reverses an earlier "no front test" instruction.
- **Lonestone's "legacy checkpoints" were never built.** Zero occurrences in `.boilerstone`. Our
  090's `0.0.0` default plus a baseline release is already the answer.

## Loose ends worth one line each

- **Vendored files are formatted for `@acme`.** `bg add` rewrites the scope at copy time, which changes line lengths, so with a scope of another length (`@app`) the first `bun run check` fails on `packages/ui/src/components/empty-state.tsx`; golden is green only because `@golden-app` wraps like `@acme`. **Fixed** (`1fe7fd4`, `d73401e`, `797fae7`): the three scope-dependent lines carry `// oxfmt-ignore`, a contract test renders every file at every scope length from 2 to 64 and runs `vp fmt --check`, `create` refuses a scope over 64 characters, and golden runs with `@app`. Formatting at `add` time was rejected: it would ship `oxfmt` (about 6 MB native per platform) in the CLI.
- **`ui/shadcn` details.** Its `checks` (`bun run typecheck`) run every workspace, not only `packages/ui`. Its theme names the `Urbanist Variable` and `Faustina Variable` fonts, which it does not install. Item `dependencies` are informational (printed, never written): the module installs the whole union until 030's per-item merge has a patch. A v1 project whose old `utils` wrote `packages/ui/package.json` cannot adopt `ui/shadcn` without `--force`.
- **This repo's own root `vite.config.ts`** has the same no-op React override stage 2 fixed in `tooling/vite-plus`: adding the plugin enables no rule.
- **CI on #16 is green.** The 2 `media.routes.test.ts` failures ("Unhandled error between tests",
  empty body) were seen only under Bun 1.3.11 and pass on 1.4.2. Auto-fix stays **off**.
- **`add` produces module records and `regions` for env keys, and nothing else of tier 2.** It
  refuses a variant that declares a patch, and it does not stage intentions (spec 050 step 14).
  `bg doctor`'s patches and intentions checks are proven on hand-written fixtures only.
- **`parseProjectManifest` rebuilds the object**, so unknown top-level `bg.json` fields are dropped
  on every write. Spec 020 says to preserve them with a warning.
- **Spec 060's rule to overwrite a file when its recorded sha256 matches** is wired for modules
  (`stageModules`) and not for items: `apply-plan.ts` throws on any differing file unless `--force`,
  whatever the record says.
- **`bg create --yes` is parsed and discarded** (`void yes` in `packages/cli/src/cli.ts`), and
  `--scope` is validated only after the template has been copied.
- **Spec inconsistencies.** 050 says `.bg/session.md`, 065 says `.bg/add/session.md`. No spec
  defines a staged `add` intention file. 060's "foreign edit" cannot be detected, because `regions`
  records an owner only. Peers live only in `module.json`, so `doctor` reads the local registry.
  090's example manifest still shows `"version": 1`.
- **`portless` vendors `scripts/dev-portless.ts` and its test at the project root.** The template's
  root `typecheck` and `test` fan out to workspaces only, so golden never runs them.
- **The `utils` item's `packages/ui/package.json` uses `^` ranges**, so the golden install is not
  reproducible.
- **`scripts/pack-cli.ts` has a dead `rewriteImports` and a duplicate `replaceAll`.** `bun run knip`
  fails at `a47036e`: unused exported types in `packages/cli/src/doctor.ts` and
  `packages/cli/src/intentions/lint.ts`.
- **Lint baseline: 18 `no-console` warnings** at `833d2ef`, up from 16 at `f162f10`.
- **`bun run gen:commands`** emits unformatted Markdown, so `verify` fails immediately after it
  runs. The generator wants a `vp fmt --write` at the end.
- **`bun.lock` declares `"name": "treashunt"`** at the root. Harmless. P1's re-lock did not rename
  it. The prune it would cost has already happened (`f7c17c1`).
- **`db:studio` is broken:** `drizzle-kit studio` runs without `--config`, looks for
  `drizzle.config.json`, and exits 1. It needs `--config ./src/modules/db/db.config.ts` and
  credentials for the local D1 file.
- **`auth:generate` is still destructive.** `organization.deletedAt` and `organization.settings`
  are hand-written in the generated `db.auth-schema.ts` while `organization()` declares no `schema`
  or `additionalFields`, so a regeneration drops both columns — and `auth.config.ts` and
  `auth.macro.ts` depend on them. treashunt has the same hole.
- **`apps/spa/src/hooks/use-session.ts`** is a three-line pass-through. Keep or delete.
- **`@testing-library/user-event`** is declared in the root `package.json` and imported nowhere.
- **035 says a filled category points at `--replace`; 050 says `bg replace`.** The code follows 050.
- **Env files.** 035 says `.dev.vars.example` / `.env.example` with no rule to choose; 060 lists
  `env.append` as a patch with `KEY` regions. The code uses the root `.env.example` only, and wrangler
  reads `.dev.vars` beside `apps/api/wrangler.jsonc`. Shared keys such as `BETTER_AUTH_SECRET`
  conflict with 060's "two modules claiming one region is an error"; the code skips keys already
  present.
- **035 says a variant's `workspace` is "derived from home".** Repo-homed categories have no package,
  so the code requires an explicit `workspace` when a variant declares dependencies.
- **020 says `apps` is "written by app-homed modules"**, but `module.json` has no field for an app's
  kind.
- **050 `--set key=value` has no rule for which module a key addresses.** Not implemented.
- **`bg list` shows items only**, because golden runs `bg add` on every line it prints.
- **`bg add` from a `github:` source works** (`2eea6a5`, `6a86bc0`): items and modules, read
  file by file from `raw.githubusercontent.com/<owner>/<repo>/<ref>/registry/`. It was smoke-tested
  against the real repo at `@feat/platform-cli-registry`, from `create` to `doctor --strict`. **A real
  consumer is still broken**, though. With no `@ref`, the source resolves to `v<platform.version>`
  (`v0.1.0`), and the repo has no tags while `main` has no `registry/`. That needs a tagged release
  and a republished CLI.
- **`github:` limits.** A `copy` glob is refused, because raw HTTP cannot list a directory; spec
  035's `packages/auth/**` example needs a published file index. A bare name costs about 14 probe
  requests. `doctor` does not check peers for a github source; it is offline, and leaves a note. A
  bad `GITHUB_TOKEN` makes raw.githubusercontent.com answer 404 even for a public repo, and the
  error now says so.
- **Recorded `items.*.source`** is the source as given (`github:o/r@ref/button`), not 020's
  `@bg/button`. With no ref, it loses the tag pin.
- **`templates/base/_gitignore` does not ignore `.react-router/`.**
- **The spa plan's `npmDependencies` lists `react` and `react@19.2.8` side by side**, with no dedupe.
- **The SPA root `ErrorBoundary` shows "Unexpected error" on a 404**; `isRouteErrorResponse` would
  fix it.
- **`react-router dev` warns about a missing `HydrateFallback`.**
