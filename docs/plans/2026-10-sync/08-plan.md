# 08 — Execution plan

Written 2026-10-29. [07-handoff.md](./07-handoff.md) says where the branch stands and what is
already settled; this file says what to do, in what order, and how to know each step is done.

**Updated 2026-10-30: every step below is done (`a47036e`).** Each opens with a **Done** line that
says what landed, with commit hashes. Where a premise or an instruction turned out wrong, the
original text is kept "for the record", the way P1 does. What to do next is in
[Next steps](#next-steps).

Every acceptance line is a command with an expected result. `bun run verify` must exit 0 at every
commit, and it is the gate of CI (`.github/workflows/ci.yml` is one job:
`bun install --frozen-lockfile && bun run verify`, then, since `9ee6dd0`, `bun run golden`).

## Shape of the work

It was not one line. After two shared prerequisites it split into two tracks that touch different
files and can be done in either order, or by two people at once.

```
P1 Bun pin ──┐
P2 template ─┴─► A1 entry package ──► A2 dockerfile runs ──► A3 docker verify ──┐
                                                                                ├─► C1 golden project
                 B1 bg.json v2 ──► B2 add records ──► B3 doctor ──► B4 record ──┘
```

Track A finishes the providers. Track B makes the manifest able to carry what `doctor` reads. The
only thing that needs both is the golden project, which is also what would have caught most of
this session's findings. (It covers less than that: see C1.)

---

## P1 — Align the Bun pin

**Done 2026-10-30 — and the premise below was wrong.** `bun install --frozen-lockfile` failed
under 1.4.2 too: `bun.lock` was stale, because the `apps/cli` → `packages/cli` move and three
`@types/bun` devDependencies were never re-locked. The re-lock was the CI fix, and Bun 1.3.11
accepts the re-locked file. The pin moved to 1.4.2 anyway, for alignment. The image build then
failed on a second, unrelated cause — the SPA prerender's `ECONNREFUSED 127.0.0.1` under Debian's
`::1`-first `localhost` — fixed in the template. Details in the dockerfile module's README.

**Why (as first written, kept for the record):** a `docker build` of
`registry/modules/provider/dockerfile` dies on `bun install --frozen-lockfile` with
`error: lockfile had changes` under Bun 1.3.11, because `bun.lock` is written by 1.4.2. The same
mismatch hid three missing `exports` subpaths for a whole session — invisible locally, red in CI.

**Touch:** `package.json` (`packageManager`), `templates/base/package.json` (`packageManager`), and
the two `FROM oven/bun:1.3.11` lines in
`registry/modules/provider/dockerfile/template/Dockerfile`.

**Do:** set all four to `1.4.2`. CI needs no change — it reads `bun-version-file: package.json`.

**Accept:**

- `bun install --frozen-lockfile` exits 0 (it did **not** locally either; see above).
- `docker build -f <materialised template> .` gets past `bun install` and through the SPA build.
  The recipe is in the dockerfile module's README; remember the `.dockerignore` has to sit beside
  the Dockerfile at the context root.
- CI on #16 goes further than it does today. The two failing `media.routes.test.ts` tests are the
  thing to re-read afterwards: "Unhandled error between tests" with an empty body under 1.3.11 may
  simply be the version.

**Watch:** this is the one change that moves every contributor's toolchain. Do it alone, in its own
commit, so a bisect can find it.

---

## P2 — Bring `templates/base` up to spec 010

**Done 2026-10-30, except the `bg.json` row, which stays with B1** (it landed there, `af4352d`).
Two gaps this section missed: `.acme-init.json` was still in `_gitignore` (a legacy-init leftover
010 forbids), and `typecheck` / `test` exited 1 on the empty workspace ("No workspace packages
matched the filter"), which breaks 010's own acceptance. Both fixed; the aggregate scripts now pass
`--if-present`. The template's
`vite.config.ts` copies the root's fmt options so vendored registry files pass `check` as
installed. Observed on a fresh create + install: `check`, `typecheck`, `test` all exit 0.

**Why:** spec 010 is a MUST list and the template breaks three items. The golden project (C1) is
built from this template, so every gap here shows up there.

| Spec 010 says                                                          | Template has                                             |
| ---------------------------------------------------------------------- | -------------------------------------------------------- |
| `bg.json` with `version: 2`, empty `modules`/`items`/`files`/`regions` | `version: 1`, `installed: {}`, `capabilities: []`        |
| `.gitignore` ignores the `.bg/` scratch root                           | `bg.upgrade/` — a name no spec uses any more             |
| Vite+ check tooling stubs: `fmt`, `lint`, `check`                      | only `check`, and it is `echo "no check configured yet"` |
| Husky prepare hook stub                                                | absent                                                   |

**Touch:** `templates/base/bg.json`, `templates/base/_gitignore`,
`templates/base/package.json`.

**Do:** the `bg.json` half lands with B1, since it is the v2 shape. The `_gitignore` and script
stubs are independent and cost minutes. `.bg/` is the name used by specs 010, 050, 065 and 090.

**Accept:** `bun run bg -- create /tmp/t --yes --no-git --no-install --registry local:./registry`
then, in `/tmp/t`, `bun run check` does something other than echo, and `cat .gitignore | grep '.bg/'`
matches.

---

## A1 — A package for the API entry, and a one-sentence spec amendment

**Done 2026-10-30.** `aad1c96` adds the sentence to spec 035: an app-homed module MAY write a thin
entry under `apps/<id>/src`. `783d331` creates `packages/api-runtime` and reduces
`apps/api/src/index.ts` to `export default serve(app)`. `grep -rn 'cloudflare:workers' apps/`
returns nothing at `a47036e`. The `bun.lock` change in `783d331` is 16 added lines; the
`better-sqlite3` prune expected below had already happened in `f7c17c1`. CI on `783d331` is green
(run 41035969379).

**Why:** `registry/modules/provider/dockerfile` cannot run. Its `CMD` is
`bun apps/api/src/index.ts`, and that file is `export default { fetch }` behind
`CloudflareAdapter` — it never listens on a port. The listening variant has to come from somewhere
a module is allowed to write.

**The spec problem to settle first.** Spec 035 says, absolutely:

> MUST NOT write module source directly into `apps/*/src` — that is what makes swap and revert
> impossible.

Taken literally, the app-homed `api` and `web` categories cannot ship anything at all, because an
app's code lives in its `src`. The rule's own reason points at the way out: what must not live
there is _module source_, because a module that owns files in an app's `src` cannot be swapped.

**Recommendation:** amend 035 with one sentence — an app-homed module MAY write a thin entry under
`apps/<id>/src` whose only content is an import from the module's package and a call into it;
anything else belongs in the package. Then `apps/api/src/index.ts` is three lines a provider
variant can replace, and the composition lives in a package where `remove` and `replace` work.

**Touch:** `docs/specs/035-module-registry.md` (the seam section), a new workspace — suggest
`packages/api-runtime` — holding what is today `apps/api/src/app.ts` and
`apps/api/src/lib/runtime-env.ts`, plus `apps/api/src/index.ts` reduced to the thin entry.

**Accept:**

- `bun run verify` exits 0 with the Worker path unchanged in behaviour: `apps/api` still builds and
  its 85 tests still pass.
- `grep -rn 'cloudflare:workers' apps/` returns nothing.
- A new workspace means a `bun.lock` change. Run `bun install` deliberately, read the diff before
  staging it, and expect the 94-line prune that drops `better-sqlite3` (needed by
  `drizzle-kit studio`) — decide that trade explicitly rather than discovering it.

**Watch:** this is the largest piece in the plan and the only one that moves working application
code. Do it test-first; the 85 `apps/api` tests are the safety net and they are good.

---

## A2 — Make the `dockerfile` provider run

**Done 2026-10-30 (`75e91fd`), without `.listen(PORT)`.** The step below says to call it; that was
not done. Bun serves a default-exported `{ port, fetch }` by itself, so calling `.listen` as well
would start two servers. The dockerfile module ships a variant of `@acme/api-runtime` whose
`serve(app)` returns `{ port, fetch }`. It serves the built SPA files first, falls back to
`index.html` for a GET with `Accept: text/html` that would otherwise 404, and exits on SIGINT and
SIGTERM. Installing it overwrites `packages/api-runtime`.

**Touch:** `registry/modules/provider/dockerfile/` (a second variant or an updated template), the
new entry package from A1, and the three-URL assumption.

**Do (as first written, kept for the record):** the entry package gains a listening path —
Elysia's default Bun adapter, `aot` left on, `.listen(PORT)`, serving the SPA's built assets from
the same origin. Then check the origins
question rather than assuming it: `appEnvSchema` requires `SPA_URL`, `SSR_URL` and `API_URL`, and
`apps/api/src/lib/origins.ts` derives the CORS allow-list from them. A single-origin container may
need nothing more than `SPA_URL = SSR_URL = API_URL = APP_URL`. Read `origins.ts` first; reshape the
schema only if that fails.

**Accept:** `docker compose up` from a generated project answers `GET /health` with
`{"status":"ok"}`, and the SPA loads from the same origin. Until that has actually been observed,
the module README keeps saying the module does not run.

---

## A3 — Verify, then say so

**Done 2026-10-30 (`a47036e`), in the order the step demands:** built, run, observed, then the README
rewritten. `docker build` and `docker run` or `compose up` reach healthy; `/health`, `/`, the built
assets, the SPA deep-link fallback, `/openapi` and `/auth/get-session` answer. The provider cannot
sign anyone in: it has no database and no media storage. The full list of what works and what does
not is in [07](./07-handoff.md) §"What exists now".

**Do:** nothing new. Re-run the materialised build, run the container, and only then rewrite the
"this module does not run yet" section of
`registry/modules/provider/dockerfile/README.md`.

**Watch:** this step exists because the first draft of that README claimed the image built before
anyone had built it. The claim was wrong. Keep the order: build, observe, then write.

---

## B1 — `bg.json` v2

**Done 2026-10-30 (`af4352d`).** `bg.json` is written at `version: 2`. A v1 manifest is read, and
rewritten to v2 with a message that says so, as spec 020 requires. `templates/base/bg.json` is v2,
which closes P2's last row.

**Why:** spec 020 says `version` MUST be `2`, and the v2 shape is what carries everything `doctor`
reads. The code writes `version: 1` and the type is literally `version: 1`
(`packages/schema/src/project-manifest.ts:23`, and the two literals at `:163` and `:185`). Spec and
implementation disagree, `git tag` is empty and no project consumes the platform, so this is free
today and needs 020's migration path after the first tag.

**The v2 shape, from spec 020:** `version: 2`; `apps: [{ id, dir, kind }]`; `modules: { <category>:
[{ id, variant, version, installedAt, options, patches, intentions }] }`; `items: { <name>: {
source, version, installedAt } }`; `files: { <path>: { owner, sha256 } }`; `regions: { <file>: {
<region>: owner } }`. `installed` splits into `items` and `modules`; `capabilities` is dropped.

**Touch:** `packages/schema/src/project-manifest.ts` and its test,
`packages/schema/src/index.ts`, `templates/base/bg.json`, `packages/cli/src/create.ts`,
`packages/registry/src/apply-plan.ts` and `resolve-plan.ts`.

**Do:** v2 types and parser, plus the v1 read path 020 line 100 already specifies — v1 manifests
MUST stay readable, and the CLI rewrites them on first write, treating pre-v2 files as user-owned.
State that in the output rather than doing it silently; 020 requires it to be stated.

**Accept:**

- `bun test packages/schema` covers: a v2 manifest round-trips; a v1 manifest is read and rewritten
  to v2 with `files` and `regions` empty; an unknown version fails closed (020 line 105).
- `bg create` writes `version: 2`, proven by a smoke create, not by reading the code.
- `packages/cli/src/create-add.test.ts` still passes.

---

## B2 — `add` records `files`, `regions`, `modules` and `apps`

**Done 2026-10-30 (`c2ac047`), for `files` only.** `add` records the sha256 and owner of every file
it writes. It does not record `regions`, `modules` or `apps`: no code produces them. No `add` applies
a patch or installs a module yet, so there is nothing to record. Both gaps are in
[07](./07-handoff.md) §"Loose ends worth one line each". The step's heading and `Do` below are kept
as first written.

**Why:** this is the step that was missing from every earlier draft of the plan.
`git grep -n "sha256\|regions\|createHash" -- packages` returns **nothing**. `apply-plan.ts` writes
`installed[name] = { source, version, installedAt }` and nothing else. So `doctor` has nothing to
read back, and spec 050's `add` algorithm step 12 — "Update `bg.json`: `modules` / `items`, `files`
(sha256), `regions`, `apps`, patch outcomes" — is unimplemented.

**Touch:** `packages/registry/src/apply-plan.ts`, `resolve-plan.ts`, `types.ts`.

**Do (as first written, kept for the record):** hash every written file (`Bun.CryptoHasher` or
`node:crypto`), record owner and sha256 under `files`; record each applied region under `regions`
with its owner; move item records to `items` and module records to `modules`. Keep `apply-plan`'s existing `skippedIdentical` behaviour — it is what
makes a second `add` idempotent, which spec 050's acceptance list requires.

**Accept:**

- `bg add button` twice: the second run reports every file as skipped and leaves `bg.json`
  byte-identical except `installedAt`.
- After one `add`, `bg.json` `files` has one entry per written file, and each sha256 matches
  `shasum -a 256` of the file on disk.
- `bg add --dry-run` leaves the tree and `bg.json` byte-identical (spec 050 step 9).

---

## B3 — `bg doctor`

**Done 2026-10-30 (`ce46708`).** `bg doctor [--json] [--strict]` runs the six checks below. The
question under "Decide first" is settled: `doctor` checks only the paths `bg.json` records, and an
unrecorded file is not drift (`untrackedButExpected` is always `[]`). The regions, patches and
intentions checks are proven on hand-written fixtures only, because no `add` produces those records
yet. The contract is in [07](./07-handoff.md) §"What exists now".

**Why:** MUST-ship-v1 in spec 000, fully specified in spec 050, and the success metric in 000 line
54 ("reports drift between `bg.json` and the tree without network access") cannot be met without it.

**Spec 050's six checks**, which are the command's structure:

| Check      | Reports                                                       |
| ---------- | ------------------------------------------------------------- |
| Manifest   | Schema version, module and item counts                        |
| Files      | Missing, user-modified (sha mismatch), untracked-but-expected |
| Regions    | Present / missing / owned by another module / foreign edit    |
| Patches    | Recorded `failed` outcomes                                    |
| Intentions | Pending (staged, unresolved), applied, skipped                |
| Peers      | A module whose peer category is now empty                     |

`--json` for machines, `--strict` exits non-zero on warning or error.

**Touch:** `packages/cli/src/doctor.ts` (new), `packages/cli/src/cli.ts` dispatch, and a reader in
`packages/registry`.

**Accept:** spec 050's own line — `bg doctor --strict` is green immediately after a clean `add` with
no pending intents. Plus: modify one installed file and `doctor` names it as user-modified; delete
one and it is reported missing.

**Decide first (as first written, kept for the record):** unresolved question 1 of
[06](./06-platform-gaps.md) — is a file inside a module's directory that `bg.json` does not record
drift, or the consumer's own code? `--strict` being green right after `add` implies drift, which makes `doctor` noisy the moment anyone adds a
file next to a vendored one. Settle it before implementing; it shapes the Files check.

---

## B4 — `bg record`

**Done 2026-10-30 (`f162f10`), with the destination corrected.** The accept line below says both id
forms land in `platform.intentions`. Specs 065 and 020 say otherwise, and they win: a release id,
`vX.Y.Z/slug`, goes to `platform.intentions`; an install id, `<category>/<module-id>/<slug>`, goes to
that installed module's record, and is an error if the module is not installed. Two fixes landed
alongside B3 and B4: `ea28156` makes `bg add --yes` an option instead of an item name, and `8a3962f`
makes `bg create` name the project after the directory's basename, which also fixes `bg create .`.

Smaller: it closes the intention lifecycle that `bun run intentions:lint` already validates and
spec 065 requires. Mostly a manifest write, and `packages/schema` owns the manifest.

**Accept (as first written, kept for the record):** `bg record <id>` and
`bg record <id> --skip "<reason>"` both land in `platform.intentions`, and `bg doctor` then reports
that intention as applied or skipped rather than pending.

---

## C1 — One golden project

**Done 2026-10-30 (`177c690`, `9ee6dd0`), and it covers less than "What it would have caught"
below claims.** `bun run golden` is a CI step after `verify` (`9ee6dd0`); follow-ups are `5c931d3` (failure messages
name `bun`, not its resolved path), `a7fdc85` and `c26ffb6` (docs). CI is green on `a47036e`, run
41039492663, the first with the golden step; golden took 1.3s in total there. It runs the packed
CLI, copied outside the repo, because a pack run in place silently falls back to the repo's
`templates/base` through `packages/cli/src/paths.ts`. It installs 7 items:
`utils button badge card api-elysia config portless`. It excludes `spa-react-router`: that item's
entry in `registry/apps/registry.json` lists 3 of its 8 files (`react-router.config.ts`,
`src/root.tsx`, `vite.config.ts`, `wrangler.jsonc` and `app.css` are never vendored), so
`react-router typegen` fails. Against the claim below, golden catches the `apps/cli` →
`packages/cli` path churn class, because it goes through the pack's import rewriting. It does
**not** catch missing `exports` subpaths, since no vendored file imports another workspace package,
and it does **not** catch the Bun pin: `packageManager: bun@9.9.9` still installs.

**Why last, and why not the matrix.** Spec 070 asks for golden projects asserted byte-for-byte per
peer combination plus an E2E matrix. One fixture catches the class of regression the matrix is for
at a fraction of the cost; the matrix earns its keep when there is more than one peer combination,
and today there is one. `scripts/gen-playground.ts` is most of the scaffolding already.

**Accept:** a CI step that runs `bg create` → `bg add` → `bun install` → `typecheck` → `test` →
`bg doctor --strict` in a temp directory and fails on any drift.

**What it would have caught this session (as first written, kept for the record):** the missing
`exports` subpaths, the `apps/cli` → `packages/cli` path churn, and the Bun pin — all three were
found by CI or by a Docker build rather than by a test. Only the path churn holds; see the Done
paragraph at the top of this step.

---

## Next steps

Everything above is done. What is left follows from what those steps found, in this order:

1. **Complete the `spa-react-router` registry item.** List all of its files in
   `registry/apps/registry.json`, then drop its entry from `EXCLUDED` in
   `scripts/golden-project.ts`. First, because it is what makes golden cover `exports` subpaths, the
   regression class C1 was meant to catch and does not yet. **Accept:** `bun run golden` exits 0 with
   `spa-react-router` among the installed items.
2. **A module install path in `bg add`.** Read `module.json`: the copy list, the env, and a record
   under `bg.json` `modules`. Second, because it is the prerequisite for installing a provider
   through the CLI and for a dockerfile golden run; today the provider can only be materialised by
   hand. It is also the first code that would write `modules` records.
3. **Dissolve the legacy apps**, in the order [06](./06-platform-gaps.md) argues: extract one item
   per commit, smallest first (`apps/static`), delete each source only once its item is green in the
   golden project, and leave `apps/api` for last (87 tests at `a47036e`, and the most peers). Third,
   because it was gated on C1, which exists now. Golden's limits are why step 1 comes before the
   first front item.

The loose ends these steps left open are in [07](./07-handoff.md) §"Loose ends worth one line each".

---

## Not in this plan

- **The dockerfile provider's database, storage and `/auth` route.** Three separate decisions: a
  libsql `db` module, filesystem storage, and Better Auth's `basePath` against renaming the SPA's
  `/auth/*` routes.
- **A third provider.** Two prove the seam.
- **Postgres.** It moves Drizzle off the sqlite dialect and drags `db.config.ts`, every migration
  and the real-SQLite test helpers with it. Separate `db` module, separate decision.
- **An `email` provider variant.** Resend is plain HTTP and works under both providers; SMTP is the
  provider-bound one, so a future `smtp` module declares `peers.provider: ["dockerfile"]`.

## The first thirty minutes of the next session

```bash
git log --oneline 4b329e8..HEAD          # what the branch did since main
bun run verify                            # expect 0
bun run golden                            # expect 0; packs the CLI, `bun install` needs the network
gh pr checks 16 --repo Netoun/bonne-garde-boilerplate
```

Then step 1 of "Next steps", in its own commit.
