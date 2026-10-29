# 08 — Execution plan

Written 2026-10-29. [07-handoff.md](./07-handoff.md) says where the branch stands and what is
already settled; this file says what to do, in what order, and how to know each step is done.

Every acceptance line is a command with an expected result. `bun run verify` must exit 0 at every
commit, and it is the whole of CI (`.github/workflows/ci.yml` is one job:
`bun install --frozen-lockfile && bun run verify`).

## Shape of the remaining work

It is not one line. After two shared prerequisites it splits into two tracks that touch different
files and can be done in either order, or by two people at once.

```
P1 Bun pin ──┐
P2 template ─┴─► A1 entry package ──► A2 dockerfile runs ──► A3 docker verify ──┐
                                                                                ├─► C1 golden project
                 B1 bg.json v2 ──► B2 add records ──► B3 doctor ──► B4 record ──┘
```

Track A finishes the providers. Track B makes the manifest able to carry what `doctor` reads. The
only thing that needs both is the golden project, which is also what would have caught most of
this session's findings.

---

## P1 — Align the Bun pin

**Why:** proven, not supposed. A `docker build` of `registry/modules/provider/dockerfile` dies on
`bun install --frozen-lockfile` with `error: lockfile had changes` under Bun 1.3.11, because
`bun.lock` is written by 1.4.2. The same mismatch hid three missing `exports` subpaths for a whole
session — invisible locally, red in CI.

**Touch:** `package.json` (`packageManager`), `templates/base/package.json` (`packageManager`), and
the two `FROM oven/bun:1.3.11` lines in
`registry/modules/provider/dockerfile/template/Dockerfile`.

**Do:** set all four to `1.4.2`. CI needs no change — it reads `bun-version-file: package.json`.

**Accept:**

- `bun install --frozen-lockfile` exits 0 (it already does locally; the point is CI and the image).
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

**Touch:** `registry/modules/provider/dockerfile/` (a second variant or an updated template), the
new entry package from A1, and the three-URL assumption.

**Do:** the entry package gains a listening path — Elysia's default Bun adapter, `aot` left on,
`.listen(PORT)`, serving the SPA's built assets from the same origin. Then check the origins
question rather than assuming it: `appEnvSchema` requires `SPA_URL`, `SSR_URL` and `API_URL`, and
`apps/api/src/lib/origins.ts` derives the CORS allow-list from them. A single-origin container may
need nothing more than `SPA_URL = SSR_URL = API_URL = APP_URL`. Read `origins.ts` first; reshape the
schema only if that fails.

**Accept:** `docker compose up` from a generated project answers `GET /health` with
`{"status":"ok"}`, and the SPA loads from the same origin. Until that has actually been observed,
the module README keeps saying the module does not run.

---

## A3 — Verify, then say so

**Do:** nothing new. Re-run the materialised build, run the container, and only then rewrite the
"this module does not run yet" section of
`registry/modules/provider/dockerfile/README.md`.

**Watch:** this step exists because the first draft of that README claimed the image built before
anyone had built it. The claim was wrong. Keep the order: build, observe, then write.

---

## B1 — `bg.json` v2

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

**Why:** this is the step that was missing from every earlier draft of the plan.
`git grep -n "sha256\|regions\|createHash" -- packages` returns **nothing**. `apply-plan.ts` writes
`installed[name] = { source, version, installedAt }` and nothing else. So `doctor` has nothing to
read back, and spec 050's `add` algorithm step 12 — "Update `bg.json`: `modules` / `items`, `files`
(sha256), `regions`, `apps`, patch outcomes" — is unimplemented.

**Touch:** `packages/registry/src/apply-plan.ts`, `resolve-plan.ts`, `types.ts`.

**Do:** hash every written file (`Bun.CryptoHasher` or `node:crypto`), record owner and sha256 under
`files`; record each applied region under `regions` with its owner; move item records to `items` and
module records to `modules`. Keep `apply-plan`'s existing `skippedIdentical` behaviour — it is what
makes a second `add` idempotent, which spec 050's acceptance list requires.

**Accept:**

- `bg add button` twice: the second run reports every file as skipped and leaves `bg.json`
  byte-identical except `installedAt`.
- After one `add`, `bg.json` `files` has one entry per written file, and each sha256 matches
  `shasum -a 256` of the file on disk.
- `bg add --dry-run` leaves the tree and `bg.json` byte-identical (spec 050 step 9).

---

## B3 — `bg doctor`

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

**Decide first:** unresolved question 1 of [06](./06-platform-gaps.md) — is a file inside a
module's directory that `bg.json` does not record drift, or the consumer's own code? `--strict`
being green right after `add` implies drift, which makes `doctor` noisy the moment anyone adds a
file next to a vendored one. Settle it before implementing; it shapes the Files check.

---

## B4 — `bg record`

Smaller: it closes the intention lifecycle that `bun run intentions:lint` already validates and
spec 065 requires. Mostly a manifest write, and `packages/schema` owns the manifest.

**Accept:** `bg record <id>` and `bg record <id> --skip "<reason>"` both land in
`platform.intentions`, and `bg doctor` then reports that intention as applied or skipped rather
than pending.

---

## C1 — One golden project

**Why last, and why not the matrix.** Spec 070 asks for golden projects asserted byte-for-byte per
peer combination plus an E2E matrix. One fixture catches the class of regression the matrix is for
at a fraction of the cost; the matrix earns its keep when there is more than one peer combination,
and today there is one. `scripts/gen-playground.ts` is most of the scaffolding already.

**Accept:** a CI step that runs `bg create` → `bg add` → `bun install` → `typecheck` → `test` →
`bg doctor --strict` in a temp directory and fails on any drift.

**What it would have caught this session:** the missing `exports` subpaths, the `apps/cli` →
`packages/cli` path churn, and the Bun pin — all three were found by CI or by a Docker build rather
than by a test.

---

## Not in this plan

- **Dissolving the legacy apps.** It is agreed in principle and
  [06](./06-platform-gaps.md) argues the order, but it is gated on C1: the legacy tree is currently
  the only proof the code works, and `apps/api`'s 85 tests are that proof. Extract one item per
  commit, smallest first (`apps/static`), delete each source only once its item is green in the
  golden project, and leave `apps/api` for last.
- **A third provider.** Two prove the seam.
- **Postgres.** It moves Drizzle off the sqlite dialect and drags `db.config.ts`, every migration
  and the real-SQLite test helpers with it. Separate `db` module, separate decision.
- **An `email` provider variant.** Resend is plain HTTP and works under both providers; SMTP is the
  provider-bound one, so a future `smtp` module declares `peers.provider: ["dockerfile"]`.

## The first thirty minutes of the next session

```bash
git log --oneline 4b329e8..HEAD          # what this session did
bun run verify                            # expect 0
gh pr checks 16 --repo Netoun/bonne-garde-boilerplate
git grep -n "sha256\|regions" -- packages # expect nothing: that is B2
```

Then P1, in its own commit.
