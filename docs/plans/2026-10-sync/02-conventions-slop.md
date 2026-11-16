# 02 — Conventions skill, hooks, slop-sweep

**Recommendation: fix the skill chain first (one line), then update the skill's repo table,
then run a scoped sweep after the platform WIP is committed.** In that order — a sweep run
with a stale brief fixes the wrong things.

## Interpretation of "the conventions hook"

There is no hook that loads conventions. Searched: `~/.claude/hooks/` (empty),
`~/.claude/settings.json`, and every repo's `.claude/settings*.json` and `opencode.json`.
The only hooks configured anywhere are global and unrelated:

| Hook                         | Command                 |
| ---------------------------- | ----------------------- |
| `PreToolUse`/Bash            | `rtk hook claude`       |
| `UserPromptSubmit`           | `codegraph prompt-hook` |
| `PermissionRequest` / `Stop` | `afplay` sounds         |

So "the conventions hook" is read here as **the mechanism that hooks conventions into a
session**: the `stack-conventions` → `elysia-react-router-conventions` routing, plus the git
hooks that enforce the gate. Both are covered below.

## Finding 1 — the conventions skill is off

`~/.claude/settings.json` → `skillOverrides`:

```json
"elysia-react-router-conventions": "off"
```

`stack-conventions` is **on**, and its only job is to detect the stack and route to that skill.
slop-sweep's step 2 routes there too, to fill the brief's Rules section. So:

- every session on this stack reaches a dead end at the routing step;
- a slop-sweep brief written here would silently miss the stack's rules;
- the four reference files (`api-modules`, `data-and-migrations`, `frontend`, `testing`,
  `project-differences`) are unreachable.

**Fix:** delete that one line. If it was turned off because the skill was wrong rather than
noisy, Finding 2 is why.

**Cost:** one line. **Do it before anything else in this folder.**

## Finding 2 — the skill knows two repos; there are four

`references/project-differences.md` opens with "Two known repos follow this stack: batch and
treashunt." Both missing repos are the ones that matter most here:

| Repo            | Why it does not fit the current skill                                                                                                                                             |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **keeper**      | Postgres + `postgres`/pglite, Docker host, no wrangler, no D1, no R2 (`lib/storage.ts` on S3), `vp` instead of oxlint, openspec workflow, `bun --watch` instead of `wrangler dev` |
| **boilerplate** | Platform direction: CLI + registry + template. `apps/cli`, `packages/{registry,schema}`, `registry/`, `migrations/`, `docs/specs/`. None of it is in the skill's map.             |

The skill already anticipates this — §Read first point 5 says to skip the Cloudflare rules on a
Bun/Docker host — but nothing tells a reader which repo they are in, and the detect table has no
row for either.

Three concrete corrections, all in `project-differences.md`:

1. **Add a detect row per repo.** Markers: keeper = `Dockerfile` + `openspec.json` +
   `drizzle-kit --dialect postgresql`; boilerplate = `apps/cli` + `templates/base` + `docs/specs/`.
2. **Record the toolchain split.** The skill's §Before you finish lists `bun run lint` then
   `bun run fmt:check`. True for batch/treashunt (oxlint + oxfmt + `lint-staged`). On
   boilerplate and keeper those scripts shell out to `vp`, and `bun run check` does both at once.
   Pre-commit differs too: `bunx vp staged` here and in keeper, `bunx lint-staged` in treashunt.
3. **Record that two repos have no front tests.** The skill's §Tests mandates Vitest + RTL + MSW
   with `onUnhandledRequest: 'error'`. The boilerplate has **zero** front test files
   (`apps/{spa,ssr,static}`, `packages/ui`) after `bb35d1b "chore: drop front-end tests and
scaffolding"`, and keeper dropped its SPA tests in `a7e4836`. An agent that follows the skill
   literally will write tests the repo has decided against. API tests stand: `apps/api` has 6
   test files and the TDD rule holds there.

**Cost:** ~30 lines in one reference file. **Open question:** should this skill move into the
registry as a `registry:tooling` item, so a generated project gets its own conventions? See
question 5 in the [README](./README.md).

## Finding 3 — the boilerplate has no project-level agent config

batch and treashunt both carry `.claude/settings.local.json` (permission allowlists); batch also
carries `.claude/launch.json` and a `browser-pass/` helper. The boilerplate has no `.claude/`
directory at all. Nothing is broken, but every permission prompt is answered from scratch.

**Recommendation:** add `.claude/settings.json` with the repo's real allowlist (`bun run *`,
`bunx vp *`, `bun test *`, `git` reads) once the platform commands settle — and ship it from
`templates/base`, so generated projects inherit it. That is a registry/template concern, so it
belongs in [03](./03-backport-plan.md), not here.

## Finding 4 — slop-sweep: keeper has run it twice, the boilerplate never

`~/.claude/skills/slop-sweep` is `disable-model-invocation: true` — user-invoked only. Four
rubrics: `slop`, `practices`, `tests`, `composition`.

Keeper's record (`bonne-garde-keeper/SLOP-SWEEP-PROGRESS.md`, run dir inside `.git`):

| Run        | Scope             | Slices | Result                                 |
| ---------- | ----------------- | ------ | -------------------------------------- |
| 2026-10-10 | front only        | —      | 95 findings kept, 23 applied           |
| 2026-10-27 | `apps/ packages/` | 66     | **54 findings fixed**, one commit each |

Gate at the end: typecheck green, `vp check` green (466 files), API 537 pass / 5 fail — all five
proven environmental (S3/RustFS, needs `RUSTFS_BIN`).

**Nine of its 54 findings land on paths that still exist here**, including a latent open redirect
and six `as` casts in `packages/ui`. They are listed, each checked against this tree, in
[01](./01-consumers.md) §C, and the actionable ones are "Now" items in
[03](./03-backport-plan.md). That table is the single most useful output of this audit: findings
already verified and already gated in a repo that shares our skeleton.

Also read keeper's `## Coverage` section. It lists the whole-scope scans that produced those
findings — 12-line duplicate windows, `as` / `!` / `?? <literal>` sweeps, React rules, effect
cleanup pairing, a11y, raw palette colours, raw `fetch`, test anti-patterns. Running that list
here is a cheaper first pass than a full sweep.

Worth copying from the run itself:

- **a progress ledger committed at the repo root**, so a multi-session sweep survives compaction;
- the run data living in `.git/slop-sweep/` with a `LATEST` pointer, never committed;
- **one commit per finding**, which makes a bad fix a single revert;
- recording environmental test failures as environmental, with the proof, instead of as a baseline
  "pass".

Also in keeper's notes, and relevant before planning a swarm here: the `subagent` fan-out died on
usage limits, so the whole sweep ran serially in the main session. Budget for serial.

### Why not run it on the boilerplate today

Step 1 of the skill requires `git status --porcelain` to be empty. Right now the tree has 6
modified files plus 7 untracked directories and 4 untracked scripts — the entire platform WIP
(`apps/cli`, `registry/`, `templates/`, `packages/registry`, `packages/schema`, `docs/specs/`,
`migrations/`, and `scripts/{build-registry,gen-playground,pack-cli,pack-cli.test}.ts`). A sweep
would carry all of it into its commits.

### Plan

1. Commit the platform WIP. It is a coherent feature branch; it should not sit untracked.
2. Then the two cheap mechanical passes first, because they overlap the sweep's `slop` rubric and
   cost nothing: the PR 4 deletions in [04](./04-deps-plan.md), and the two leaks in Finding 5.
3. Then `/slop-sweep --since main --only slop,practices,composition` on
   `apps/api packages apps/cli scripts` — scoped, because a full sweep of a tree whose front
   apps may be retired (README question 2) would be wasted work. Drop the `tests` rubric for the
   front; keep it for `apps/api`.
4. Keep a `SLOP-SWEEP-PROGRESS.md` at the root, as keeper does, excluded via `.git/info/exclude`.

**Estimate, by keeper's measured rate:** `apps/api packages apps/cli scripts` is well under
keeper's 415 files, so expect ~20–30 slices and a serial run over several sessions.

## Finding 5 — two leaks the sweep would find anyway

Both are white-label residue from the treashunt copy, and both are one-line fixes:

| Leak                                                                                                                                                                                                                                                      | Location                    |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Root workspace named `"treashunt"` in the lockfile while `package.json` says `"acme"` — already so at HEAD, so `f5b5d80` renamed `package.json` without regenerating the lock. Fix with `bun install`, never `rm bun.lock` ([04](./04-deps-plan.md) PR 1) | `bun.lock:6`                |
| CORS allow-list hardcodes `config.BO_URL` / `config.PLAYER_URL` — treashunt's app names; this repo has `spa` / `ssr` / `static`                                                                                                                           | `apps/api/src/app.ts:14-21` |

The second one is also the best argument for the `lib/cors.ts` + `lib/origins.ts` backport in
[03](./03-backport-plan.md): both siblings extracted exactly this out of `app.ts`.

## Order and cost

| #   | Action                                                 | Cost             |
| --- | ------------------------------------------------------ | ---------------- |
| 1   | Remove the `skillOverrides` line                       | 1 line           |
| 2   | Add the two repo rows + three corrections to the skill | ~30 lines        |
| 3   | Commit the platform WIP                                | 1 commit         |
| 4   | Fix the two leaks (Finding 5)                          | ~10 lines        |
| 5   | Scoped slop-sweep with a ledger                        | several sessions |

Item 2 can run as its own session; items 1 and 4 are smaller than the PR that would carry them.
