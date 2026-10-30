# 04 — Dependency plan

**Recommendation: five PRs, in this order.** Sibling-proven bumps, then the unproven ones, then
better-auth, then the toolchain major, then deletions. Nothing here needs Elysia 2, and Elysia 2
is not ready.

Evidence: `bun outdated --filter '*'` (2026-10-29, 213 rows), the npm registry `dist-tags`,
`dependencies` and `peerDependencies` of each package, and the versions batch / treashunt /
keeper run today. A version a sibling runs is the cheapest proof available; a version none of
them runs is a bump we are testing first, and the plan says which is which.

## Verdict: Elysia 2 — no, not yet

| Fact                                                                                                                                                                         | Source                                                  |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `elysia@latest` = **1.4.30**, published 2026-08-26. Furthest non-experimental tag: `rc` = `2.0.0-rc.1`                                                                       | npm `dist-tags`                                         |
| `@elysiajs/eden@latest` = **1.4.9**, published 2026-03-31, peers `elysia >= 1.4.19`                                                                                          | npm                                                     |
| No Eden release is built against 2.x — that open `>=` range only _tolerates_ it                                                                                              | npm: no `2.x` line, nothing published since March       |
| `@elysiajs/openapi` on 2.x exists only as `2.0.0-exp.0`, pinned to `elysia 2.0.0-exp.12`                                                                                     | npm `dist-tags`                                         |
| RC post (19 Oct 2026) names the two-parameter `onError` as breaking; ships `bunx @elysia/codemod@latest`; says Elysia 1 plugins work after the beta hook rename was reverted | [RC post](https://next.elysiajs.com/blog/elysia-20-rc/) |
| The RC post says nothing about Cloudflare Workers, `CloudflareAdapter` or `aot: false`                                                                                       | same                                                    |
| `packageManager` is `bun@1.3.11`; third-party reports put the RC at Bun ≥ 1.4.4 (unverified)                                                                                 | our `package.json`                                      |

**Eden is the deciding constraint, not Elysia.** `AGENTS.md` makes Eden Treaty non-negotiable for
every front → API call, and Eden's inference is coupled to Elysia's internals. An Elysia 2 API
with an Eden 1.4.9 client is an untyped client.

**Re-evaluate when all three hold** — not before:

1. `elysia@latest` is a stable `2.x`;
2. `@elysiajs/eden` ships a release whose peer range names `2.x`;
3. `@elysiajs/openapi@latest` (not `exp`) accepts `2.x`.

Allowed now: a throwaway `spike/elysia-2` branch on `apps/api` only, to measure the codemod's
output and whether `CloudflareAdapter` + `aot: false` still hold. Not merged.

Same bucket, same reasoning: **`drizzle-orm` 1.0.0-rc.5** exists; stable is `0.45.4`. Watch. Note
that `better-auth@1.7.6` already peer-accepts it (`drizzle-orm: ^0.45.2 || >=1.0.0-rc.1 <2.0.0`),
so the ecosystem is moving — but an rc is an rc.

## PR 1 — sibling-proven bumps

Each target below is a version batch or treashunt runs today.

| Package                              | Here         | Target       | Runs in                                          |
| ------------------------------------ | ------------ | ------------ | ------------------------------------------------ |
| `elysia` (+ root `overrides`)        | 1.4.29       | 1.4.30       | batch, treashunt                                 |
| `drizzle-orm`                        | 0.45.2       | 0.45.3       | treashunt (`0.45.4` is latest — take it in PR 2) |
| `drizzle-kit`                        | 0.31.10      | 0.31.11      | treashunt                                        |
| `@libsql/client`                     | 0.17.4       | 0.18.0       | batch, treashunt                                 |
| `typebox`                            | 1.3.11       | 1.3.34       | treashunt (**not** 1.4.3 — see below)            |
| `react`, `react-dom` (+ `overrides`) | 19.2.8       | 19.3.0       | batch, treashunt                                 |
| `@types/react`                       | 19.2.18      | 19.3.0       | batch, treashunt                                 |
| `@types/bun`, `bun-types`            | 1.3.14       | 1.4.2        | batch, treashunt                                 |
| `wrangler`                           | 4.119.0      | 4.140.0      | treashunt                                        |
| `@cloudflare/workers-types`          | 5.20260804.1 | 5.20260925.1 | treashunt                                        |
| `packageManager`                     | bun@1.3.11   | bun@1.4.2    | keeper, and the local bun is 1.4.2               |

**Why `typebox` 1.3.34 and not 1.4.3.** `elysia@1.4.30` peer-declares
`@sinclair/typebox >= 0.34.0 < 1` — a _different_ npm package from the unscoped `typebox` v1 this
repo depends on. Nothing in elysia's metadata constrains `typebox@1.x`, so a 1.4 bump is not
blocked — but TypeBox is the library every route contract and all of Eden's inference run
through, and a minor bump there with no sibling running it is the wrong thing to discover in a
dependency PR. Take treashunt's version; move to 1.4.x on its own, after.

Two one-line fixes belong in this PR because they are the same kind of bookkeeping:

- **`bun.lock` names the root workspace `"treashunt"`** (`bun.lock:6`) while `package.json` says
  `"acme"`. Already so at HEAD, so the white-label commit (`f5b5d80`) renamed `package.json`
  without regenerating the lock. **Tried on 2026-10-29: `bun install` does not fix it** — the
  name is still `"treashunt"` afterwards. What it does instead is prune the lock by 94 lines,
  dropping `better-sqlite3@11.10.0` and its native-build tree plus `@opentelemetry/api`,
  `base64-js` and `buffer`, and adding three explicit `"@types/bun": "1.3.14"` entries. The
  current lock is stale and that pruning is probably right, but `drizzle-kit studio` wants
  `better-sqlite3`, so it belongs **in this PR's reviewed diff**, not as a silent side effect.
  Plan: do the version bumps, run `bun install`, and read the whole lock diff on purpose. The
  cosmetic name needs a one-field hand edit or nothing at all — see
  [03](./03-backport-plan.md) item 3.
- **`apps/api/package.json` has `"@types/bun": "latest"`** — an unpinned range in a repo that pins
  everything else. Pin it with the row above.

Gate: `bun run typecheck && bun run test && bun run check`.

## PR 2 — bumps no sibling runs yet

Same mechanical risk, but nobody else has absorbed it. Separate PR, separate revert.

| Package                                                                                   | Here           | Latest                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------------------------------------------- | -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `react-router`, `@react-router/{dev,node,cloudflare,serve}`                               | 8.3.0          | 8.5.1                                                                                                                                                                                                                                                                                                            |
| `resend` — **only if Resend stays**                                                       | 6.18.1         | 6.35.0 (17 minors — read the changelog). [01](./01-consumers.md) §D.2 recommends replacing it with the Cloudflare `send_email` binding, which both siblings use; that needs an `AGENTS.md` amendment first (question 7 in the [README](./README.md)). Decide before bumping, or the 17 minors are wasted review. |
| `@elysiajs/openapi`                                                                       | 1.4.15         | 1.4.16                                                                                                                                                                                                                                                                                                           |
| `@cloudflare/vite-plugin`                                                                 | 1.51.0         | 1.66.0                                                                                                                                                                                                                                                                                                           |
| `@base-ui/react`                                                                          | 1.7.0          | 1.9.0                                                                                                                                                                                                                                                                                                            |
| `tailwind-merge`                                                                          | 3.6.0          | 3.7.0                                                                                                                                                                                                                                                                                                            |
| `@react-email/render`                                                                     | 2.1.0          | 2.2.0                                                                                                                                                                                                                                                                                                            |
| `knip`                                                                                    | 6.32.0         | 6.43.0                                                                                                                                                                                                                                                                                                           |
| `@types/react-dom`                                                                        | 19.2.4         | 19.3.0                                                                                                                                                                                                                                                                                                           |
| `@types/node`                                                                             | 26.1.2         | 26.6.6                                                                                                                                                                                                                                                                                                           |
| `drizzle-orm`, `react`/`react-dom`, `@types/bun`, `wrangler`, `@cloudflare/workers-types` | PR 1's targets | latest, once PR 1 is green                                                                                                                                                                                                                                                                                       |

**One likely breakage in this PR** — reported by both siblings, not reproduced here. With `@types/node` ≥ 26.6 and recent
`@cloudflare/workers-types` under TypeScript 7, the two packages clash on `Buffer`, and
`derived.toString("hex")` stops typechecking. Both siblings hit it and solved it differently:
treashunt wraps with `Buffer.from(...)` plus `import { Buffer } from "node:buffer"`; batch added
`apps/api/src/node-buffer.d.ts` (a global `Buffer.toString(encoding)` merge, `2d975a9`) and a
`import type {} from "@batch/api/node-buffer"` in `auth.config.ts`. Our current pins
(`@types/node` 26.1.2, workers-types 5.20260804.1) may be why it has not appeared yet. Prefer
treashunt's fix: a local import beats a global type merge.

## PR 3 — better-auth 1.6.26 → 1.7.6 (far cheaper than it looks)

**Checked, and it changes the plan: neither sibling needed a source change.** Both 1.7 bumps are
dependabot group commits touching **only `package.json` files**:

```
batch@1f33f5d      "chore(deps): bump the all-dependencies group … 51 updates"   — 7 package.json, 0 src
treashunt@44a87b50 "chore(deps): bump the all-dependencies group … 90 updates"   — 8 package.json, 0 src
```

No `apps/api/src` file moved in either, and the generated `db.auth-schema.ts` shows no
1.7-specific diff — every schema difference between the repos is plugin- or domain-driven
(`admin` adds `role`/`banned`/`impersonatedBy`, `twoFactor` adds the `two_factor` table). The
APIs the consumers use (`createAuthMiddleware`, `APIError.fromStatus`, `plugins/access`,
`plugins/admin/access`) already exist in 1.6.26.

Caveat on the strength of that proof: a dependabot group bump means it _worked_, not that anyone
deliberately verified it. Still run step 2 below and read the diff.

Target **`1.7.6`** — treashunt's exact version, pinned in its root `overrides` alongside
`@better-auth/core` and `@better-auth/drizzle-adapter`. Take `1.7.14` separately. There is a
`release-1.6` dist-tag at `1.6.33` if this has to wait but the patches are wanted.

Verified facts about `better-auth@1.7.6` that shape the steps:

- It depends on `@better-auth/core: 1.7.6` directly, so adding `@better-auth/core` to `apps/api`
  is **not** required by the packaging. Both consumers already declared it back at 1.6.x (batch
  pinned `1.6.5` then `1.6.14`, treashunt `1.6.19`) to pin the whole family through overrides.
  This repo is the only one of the four that does not declare it. Do the same, for that reason.
- Lockfile peer deltas across the bump: `better-call` 1.3.7 → 1.4.0, `@better-fetch/fetch`
  1.3.1 → 1.3.2, the optional `@cloudflare/workers-types` peer dropped from `@better-auth/core`,
  and `@better-auth/drizzle-adapter`'s `drizzle-orm` peer widened to accept the 1.0 rc.
- It depends on `kysely: ^0.28.17 || ^0.29.0`. Our root `overrides` pins `kysely: 0.29.4`, which
  satisfies it. batch runs `0.29.5`; bump the override to match.
- It peer-declares `drizzle-orm: ^0.45.2 || >=1.0.0-rc.1 <2.0.0` and `drizzle-kit: >=0.31.4`, so
  PR 1's drizzle targets are fine.

Steps:

1. Bump `better-auth` + `@better-auth/drizzle-adapter` in `apps/api` **and** `apps/spa` (the SPA
   imports the client), add `@better-auth/core`, and pin all three plus `kysely: 0.29.5` in root
   `overrides`.
2. `cd apps/api && bun run auth:generate` → regenerate `db.auth-schema.ts`. Read the diff.
3. `bun run db:generate` → read the SQL → `bun run db:migrate:local`.
4. Diff the regenerated schema against treashunt's to confirm the shape matches.

Residual risk: if the regenerated schema _does_ move, the migration is destructive against an
existing database. Harmless here (no production data), but a consumer project needs a tier-3
intention either way — see [03](./03-backport-plan.md).

## PR 4 — vite-plus 0.2.8 → 1.4.0 (toolchain major, own PR)

`vp` is `lint`, `fmt`, `check` — the whole quality gate — and the catalog pins both `vite-plus`
and `@voidzero-dev/vite-plus-core`. Published 2026-10-23. A `0.2.x → 1.4.0` jump across a `1.0`
boundary will move rule defaults and formatting.

- Expect a large formatting-only diff. Land it as its own commit inside the PR so review can skip it.
- **Coordinate with keeper**, which pins the same catalog at the same `0.2.8`. Whichever repo goes
  first produces the recipe for the other.
- Fallback if the diff is unmanageable: batch and treashunt still run plain `oxlint 1.85` +
  `oxfmt 0.70` with `lint-staged`. That is a working alternative, not a regression.

## PR 5 — deletions and declarations (knip-proven)

`bun run knip` reports 12 unused files, 34 unused dependencies, 5 unused devDependencies and 2
"unlisted" ones. The unused set is almost entirely treashunt inheritance.

| Delete                                                                                            | Where         | Note                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@elysiajs/cookie`                                                                                | `apps/api`    | Unused. Elysia has cookies built in.                                                                                                                                                                                                                                                                                                                             |
| `qrcode` + `@types/qrcode`                                                                        | `apps/api`    | Domain leftover (treashunt scan codes)                                                                                                                                                                                                                                                                                                                           |
| `drizzle-seed`                                                                                    | `apps/api`    | Unused — confirm `db.seed.ts` really does not import it                                                                                                                                                                                                                                                                                                          |
| `module-alias`                                                                                    | `apps/api`    | Referenced only in `package.json`                                                                                                                                                                                                                                                                                                                                |
| **`miniflare`**                                                                                   | `apps/api`    | `grep -rn miniflare apps/api` matches **only `package.json`**, and `git log -S miniflare` shows it arrived in the initial commit. It is unused here, pinned to a `5.x-alpha`, and the siblings are on `4.20260730.0` because they actually use it for a D1 test database. **Delete it**, and re-add at the siblings' version when the D1 test seam is extracted. |
| 20 × `@tiptap/*`, `@react-router/cloudflare`, `clsx`, `tailwind-merge`, `lucide-react`, `zustand` | `apps/ssr`    | Legacy-app baggage — see question 2 in [README](./README.md)                                                                                                                                                                                                                                                                                                     |
| `@tanstack/react-virtual`, `@fontsource-variable/playfair-display`, `clsx`, `tailwind-merge`      | `apps/spa`    | idem                                                                                                                                                                                                                                                                                                                                                             |
| `@elysiajs/eden`                                                                                  | `apps/static` | The app makes no API call                                                                                                                                                                                                                                                                                                                                        |

The two "unlisted" rows are **not** both missing dependencies — read the import before acting:

| knip row                                           | What it actually is                                                                                                                                                                         | Action                                                                                         |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `cloudflare` ← `apps/api/src/lib/app.config.ts:11` | `await import("cloudflare:workers")` — the Workers **built-in module**, not the `cloudflare` npm SDK. The conventions skill names this file as the one allowed to import it.                | Add it to `ignoreDependencies` in `knip.jsonc`. **Installing the npm package would be wrong.** |
| `@react-router/node` ← `apps/ssr/vite.config.ts`   | Not imported by that file. `bun pm why` shows it is required by `@react-router/dev`, which `apps/ssr` has as a devDependency; `apps/spa` and `apps/static` declare it, `apps/ssr` does not. | Add `@react-router/node` to `apps/ssr` devDependencies, matching the other two apps.           |

**Do not run `knip --fix` on the legacy apps** until question 2 is answered. If they retire into
registry modules, this PR shrinks to the `apps/api` rows plus the two above.

## CI, in the same breath

Four defects in `.github/workflows/ci.yml`, all visible by reading it:

| Defect                                                                                                       | Fix                                                     |
| ------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `typecheck` matrix filters `@acme/${scope}` — `@bonne-garde/{cli,registry,schema}` are **never typechecked** | Add them, or switch to `bun run typecheck`              |
| Triggers on `push: ["*"]` **and** `pull_request` → every PR runs CI twice                                    | `push: [main]` + `pull_request`                         |
| Actions unpinned (`@v4`, `@v2`, `@v5`)                                                                       | SHA-pin, as keeper does                                 |
| Six jobs each restore a `node_modules` cache keyed on `bun.lock`                                             | One job, caching `~/.bun/install/cache`, as keeper does |

Target keeper's shape: one `check` job, `timeout-minutes`, `permissions: contents: read`,
`bun-version-file: package.json`, one aggregate `bun run verify`
(`check && typecheck && test && intentions:lint && registry:build`). Add lonestone's
skip-on-draft trigger — the `setup` job carries the `if`, every other job `needs` it
(`lonestone-boilerplate@66fa636`), and concurrency cancels superseded PR runs only.

## Not now (over-engineering)

- Elysia 2, drizzle 1.0 — both pre-stable. Watch, do not adopt.
- `motion` 13.0.0 → 14.7.1: a major, and `@acme/ui` declares `^13`. No consumer needs it. Skip
  until a UI module does.
- `lucide-react` 1.29.0 → 1.64.0: 35 minors of icon additions. Harmless but noisy; fold into the
  next UI-registry task, not a dependency PR.
- `typebox` 1.4.3: see PR 1. Its own PR, after a sibling or a spike.
- Renovate / Dependabot: tempting with four repos drifting, but these repos deliberately pin exact
  versions and bump in batches with a sibling as proof. A bot would replace a cheap, informed
  process with 40 PRs a week. Reconsider once the platform has consumers outside this machine.
