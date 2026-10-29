# 07 — Handoff: where to pick up

Written 2026-10-29 at `HEAD` of `feat/platform-cli-registry`. Read this, then
[06-platform-gaps.md](./06-platform-gaps.md) §1 for the provider work and its ordering.

## Start here

**One line, with evidence behind it: bump `packageManager` to `bun@1.4.2` in the root
`package.json`.**

`bun.lock` is written by Bun 1.4.2 and `packageManager` says `bun@1.3.11`. A `docker build` of the
new `provider/dockerfile` template proved what that costs:

```
bun install v1.3.11
error: lockfile had changes, but lockfile is frozen
```

The same mismatch already hid a real bug once: three `@acme/api/lib/*` subpaths were imported
without being declared in `exports`, which Bun 1.4.x resolves by falling back to the file path and
1.3.11 refuses. It was invisible locally and failed only in CI. Now it also stops any container
build. CI takes its Bun version from that same field (`bun-version-file: package.json`), so the
bump aligns local, CI and the image at once.

Do it in its own commit, then re-run the Docker build to confirm (`docker info` worked on this
machine; the materialised-template recipe is in the dockerfile module's README).

## State of the branch

Nine commits on top of the 2026-10 sync work. `bun run verify` exits **0** at `HEAD`: `vp check`,
typecheck (platform + legacy), 130-odd tests, intentions lint, registry build and all four app
builds.

| Commit    | What                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------ |
| `cdab424` | Renamed the platform slug to `bonne-garde-toolkit`; deduped `DEFAULT_PLATFORM_REMOTE` into `packages/schema` |
| `9902a33` | Merged `main` (8 conflicts); CI became one job, `bun install --frozen-lockfile && bun run verify`            |
| `7e99cc2` | Added `"./lib/*"` to `apps/api`'s `exports`                                                                  |
| `96aa898` | Moved the CLI from `apps/cli` to `packages/cli`                                                              |
| `0728ef9` | Planned the providers and reordered 06 behind them                                                           |
| `b53b499` | Added the `provider` category to spec 035                                                                    |
| `bcf680e` | Lifted the runtime env read out of `app.config.ts`                                                           |
| _this_    | `parseModuleManifest`, the module contract test, and the two provider modules                                |

## What is left, and in what shape

**The ordered, per-step plan with acceptance criteria is [08-plan.md](./08-plan.md).** Read it
before starting anything. What follows is only the shape of it, so this file stands alone.

The remainder is not one line. Two shared prerequisites, then two independent tracks:

|             |                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------ |
| **P1**      | Align the Bun pin to 1.4.2 (four sites). Proven necessary by a failed `docker build`.                                    |
| **P2**      | Bring `templates/base` up to spec 010, which it breaks in three places.                                                  |
| **Track A** | Finish the providers: a package for the API entry, then make `provider/dockerfile` run, then verify it before saying so. |
| **Track B** | `bg.json` v2 → `add` records `files`/`regions`/`modules` → `bg doctor` → `bg record`.                                    |
| **Then**    | One golden project, which needs both tracks and would have caught most of this session's findings.                       |

Tracks A and B touch different files and can be done in either order, or at the same time.

### Three findings that reshaped the plan on 2026-10-29

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

## Decisions waiting on the user

- **Rename the GitHub repo** to `bonne-garde-toolkit`. The code references are all renamed; the
  repository is still `Netoun/bonne-garde-boilerplate`. After renaming on GitHub, run
  `git remote set-url origin git@github.com:Netoun/bonne-garde-toolkit.git` — cosmetic, since
  GitHub redirects the old URL. Renaming the local folder orphans
  `~/.claude/projects/-Users-nicolqs-Workspace-bonne-garde-boilerplate/`.
- **The legacy apps.** Dissolving `apps/{api,spa,ssr,static}` into registry items is agreed in
  principle. 06 argues the order must be `bg doctor` → one golden project → extract one item per
  commit, smallest first, deleting each legacy source only once its item is green. `apps/api` last:
  85 tests and the most peers.
- **`docs/plans/`** — whether a dated audit belongs in git at all. It is committed because the
  original request asked for a folder; it will go stale and nothing in it is normative.
- **`EMAIL` binding.** AGENTS.md forbids Cloudflare proprietary APIs outside `DB` and `BUCKET`.

## Things already settled — do not re-litigate

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

- **CI is red on #16** for 2 tests of 128, in `apps/api/src/modules/media/media.routes.test.ts`:
  "Unhandled error between tests" with an empty body under Bun 1.3.11. Auto-fix was turned **off**
  deliberately. The `packageManager` bump is the first thing to try.
- **`bg create /absolute/path/my-app`** slugifies the whole path into the scope
  (`@private-tmp-...-my-app`). `slugify(options.name)` at `packages/cli/src/create.ts:59` should
  take `basename(resolve(...))`.
- **`bun run gen:commands`** emits unformatted Markdown, so `verify` fails immediately after it
  runs. The generator wants a `vp fmt --write` at the end.
- **`bun.lock` declares `"name": "treashunt"`** at the root. Harmless, and fixing it means
  regenerating the lockfile, which prunes 94 lines including `better-sqlite3`, needed by
  `drizzle-kit studio`.
- **`auth:generate` is still destructive.** `organization.deletedAt` and `organization.settings`
  are hand-written in the generated `db.auth-schema.ts` while `organization()` declares no `schema`
  or `additionalFields`, so a regeneration drops both columns — and `auth.config.ts` and
  `auth.macro.ts` depend on them. treashunt has the same hole.
- **`apps/spa/src/hooks/use-session.ts`** is a three-line pass-through. Keep or delete.
- **`@testing-library/user-event`** is declared in the root `package.json` and imported nowhere.
