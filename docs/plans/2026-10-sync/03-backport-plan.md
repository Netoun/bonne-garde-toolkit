# 03 — Backport plan

**Recommendation: route every backport to the surface that survives spec 080, and reject the
rest.** The legacy `apps/*` and `packages/*` are scheduled for deletion once each module that
replaces them is green. A "backport" that edits `apps/spa/src/` is work thrown away on a
timetable this repo has already chosen.

## The routing rule

Five destinations. Every item below names exactly one.

| Destination                                   | For                                                             | Survives 080? |
| --------------------------------------------- | --------------------------------------------------------------- | ------------- |
| **R** repo root                               | CI, `package.json` scripts, husky, `.claude/` — maintainer-side | yes           |
| **T** `templates/base`                        | What every generated project starts with                        | yes           |
| **M** `registry/modules/<cat>/<id>/template/` | Module code, per spec 035 category                              | yes           |
| **P** tier-2 patch, spec 060 catalog          | A structural edit to a project-owned file                       | yes           |
| **I** intention (`migrations/vX.Y.Z/`)        | What existing consumer projects must replay                     | yes           |
| ~~**L** legacy `apps/*`~~                     | **Only** when the file is on the 080 extraction path            | no — justify  |

An **L** item needs one of two justifications: it is the source the module will be extracted
_from_ (so a defect here propagates into the registry), or it blocks the gate today.

## Now — ordered, each item cheap and verified

### 0. ~~The auth handler is rebuilt on every request~~ → **done 2026-10-29, uncommitted**

`apps/api/src/modules/auth/auth.module.ts:29`:

```ts
return withCors(req, await createAuth().handler(req));
```

A new better-auth instance per request. treashunt fixed exactly this in `2640e15b` —
_"fix(auth): use singleton auth instance to prevent CPU limit exceeded"_ — by exporting
`authInstance` from a new `auth.service.ts` and using it in `auth.module`. keeper is a singleton
too; batch still has the bug.

Keep this item to the singleton. treashunt also turns the macro into `createAuthMacro(service)` so
tests can inject, but that is its test-seam convention, and which convention we adopt is still
open ([01](./01-consumers.md) §D.4). One decision at a time.

**This is the only item in this folder that is an active production defect** rather than a latent
trap, a style point or a missing convenience, and its symptom is already named for us by the repo
that hit it. Take treashunt's shape: `auth.service.ts` exporting `createAuthService(auth)` plus
the singleton, then `createAuthMacro(service)` as a factory so tests can inject.

It is on the 080 extraction path (the `api`/`auth` modules), so fixing it here stops the defect
being vendored into every generated project.

**Applied.** `auth.service.ts` now exports `authInstance` (it already held the module-scope
singleton, with treashunt's own comment); `auth.module.ts` uses it in the mount handler and drops
the `createAuth` import. Five lines across the two files, `withCors` untouched. Gate re-run
independently: `@acme/api` typecheck exit 0, 30 pass / 0 fail across 6 files (baseline unchanged),
`vp check apps/api` clean on 40 files. Not committed.

The real shape of the bug was worse than "an instance per request": `auth.service.ts` already had
its own singleton, so the mount handler and the macros were running on **two different**
better-auth instances, each with its own Drizzle and Resend client. They now share one.

### 1. ~~`scripts/` is neither typechecked nor tested~~ → **done 2026-10-29, uncommitted**

Spec 070 names this exact failure mode as forbidden: _"a release-tooling test that never runs is
worse than none."_ Current state:

- `"test": "bun run --parallel --filter '*' test"` — `scripts/` is outside the workspace globs,
  so `scripts/brand.test.ts` and `scripts/pack-cli.test.ts` **never run**.
- `"typecheck"` has the same hole; there is no `scripts/tsconfig.json`.

keeper's wiring is the model:

```json
"typecheck": "bun run typecheck:scripts && bun run --parallel --filter '*' typecheck",
"typecheck:scripts": "tsc --project scripts/tsconfig.json --noEmit",
"test": "bun run test:scripts && bun run --parallel --filter '*' test",
"test:scripts": "bun test scripts",
```

treashunt does the same with `bun test scripts && …`.

**The test half is free; the typecheck half is not.** `bun test scripts` already passes (5 tests,
2 files), so wiring `test:scripts` is four lines. A trial run of `tsc` over `scripts/` with
keeper's config shape surfaces about ten errors, and **most are not in `scripts/`** — the scripts
import `apps/cli/src/add.ts` and `packages/registry/src/load-registry.ts`, which carry
`exactOptionalPropertyTypes` violations, plus four `allowImportingTsExtensions` errors in the
scripts themselves. So the flag set needs tuning and the errors need fixing: budget a session,
not four lines. That the errors exist at all is the argument for doing it — code that ships the
platform has never been typechecked.

Do it first anyway: the release tooling (`pack-cli.ts`, `build-registry.ts`) is what publishes
everything else.

**Applied.** `scripts/tsconfig.json` + `typecheck:scripts` + `test:scripts`, both wired into the
root `typecheck` and `test`. The eight type errors were fixed at the type level, no `as` / `any` /
`@ts-expect-error`, and `exactOptionalPropertyTypes` was not relaxed anywhere:

- `apps/cli/src/add.ts` — `dryRun` / `force` destructured with `= false` defaults (both are only
  read for truthiness downstream, so behaviour is unchanged).
- `packages/registry/src/{load-registry,types}.ts` — `name`, `homepage`, `ref` widened to
  `| undefined` where they genuinely are; for `files`, the key is now omitted instead of set to
  `undefined`.
- `scripts/{build-registry,gen-playground}.ts` — dropped the `.ts` import extensions rather than
  enabling `allowImportingTsExtensions`, matching how every other relative import in the repo is
  written.

Two things worth knowing, both found doing it:

1. **`scripts/tsconfig.json` extends the root `tsconfig.json`, not `tsconfig.base.json`** — the
   latter is the legacy base, carries `@acme/*` paths, and would break at extraction. But
   `exactOptionalPropertyTypes` lives in `tsconfig.base.json` and **not** in the root, so it has
   to be re-declared. Which means `apps/cli/src/cli.ts:60` and `:117` carry the same violations
   latently (they forward `string | undefined` into `scope`, `registry`, `source`). The clean
   follow-up is to enable the flag in the root `tsconfig.json` and fix those two call sites.
2. **`test:scripts` is `bun test ./scripts`, not `bun test scripts`.** The bare form is a
   substring match and would sweep any future `**/scripts/*.test.ts` under `registry/` or
   `templates/` — which spec 070 forbids by name.

### 2. ~~One `verify` gate, and the platform/legacy split~~ → **done 2026-10-29, uncommitted**

Two gaps, one PR, because they are the same decision:

- No aggregate gate. keeper has `verify = check && spec:validate && typecheck && test && build`.
  Ours should be `check && typecheck && test && intentions:lint && registry:build`.
- Spec 070 normatively requires `typecheck|test|check:platform` and `:legacy` as **independent
  CI jobs**, so a legacy failure cannot block platform work. Neither exists.

Platform scope = `apps/cli`, `packages/{registry,schema}`, `scripts/`.
Legacy scope = `apps/{api,spa,ssr,static}`, `packages/{config,emails,ui}`.

**Applied.** The six scoped scripts exist, plus
`verify = check && typecheck && test && intentions:lint && registry:build`. `bun run verify`
exits **0**. Three consequences:

- The unscoped `typecheck` and `test` are now `platform && legacy` — sequential, where they used
  to be one `--parallel --filter '*'` run. Correct per spec 070, marginally slower locally.
- The unscoped `check` stays bare `vp check`, deliberately: scoping it would drop `registry/`,
  `templates/`, `migrations/`, `docs/` and the root config files from the gate.
- A new workspace matching neither `@bonne-garde/{cli,registry,schema}` nor `@acme/*` is now
  picked up by **neither** scoped script, and so by neither `typecheck` nor `test`. Worth a note
  in `AGENTS.md`.

**CI changed without CI being touched**: `.github/workflows/ci.yml:92` runs `bun run test`, which
now also runs the `scripts/` tests and the three platform packages. But CI's typecheck is still
`@acme/<matrix>` only, so `typecheck:scripts` and the platform typecheck still do not run there,
and CI still never runs `intentions:lint`, `registry:build` or `knip`. That is the CI rework in
[04](./04-deps-plan.md) §CI.

### 3. The white-label leaks → **partly done 2026-10-29, uncommitted**

Both are on the 080 extraction path (step 3, the `api` shell), so fixing them now stops the leak
being extracted into the registry:

| Leak                                                                       | Fix                                                                                                                                                                                         |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `bun.lock:6` root workspace named `"treashunt"`                            | `bun install`, then check line 6. **Not** `rm bun.lock` — `packages/{ui,emails}` carry `^` ranges and `apps/api` has `@types/bun: "latest"`, so a full re-resolve pulls unrelated bumps in. |
| `apps/api/src/app.ts` CORS hardcodes `config.BO_URL` / `config.PLAYER_URL` | Extract `lib/cors.ts` + `lib/origins.ts` from treashunt, parameterised by the project's own app URLs                                                                                        |

The second is also item 4.

### 4. `lib/cors.ts` + `lib/origins.ts` → **M** (`api` module) via **L**

batch and treashunt both pulled CORS out of `app.ts`; treashunt went further with
`lib/origins.ts`, shared between CORS and better-auth `trustedOrigins`. Our `app.ts` still has
an inline allow-list naming another product's apps.

Extract into `apps/api/src/lib/` now (the 080 source), with the app URLs read from
`lib/app.config.ts` rather than named. It lands in
`registry/modules/api/elysia-worker/template/` at extraction.

**Applied, and wider than this item described.** One `apps/api/src/lib/origins.ts` exporting
`allowedOrigins()`, `originAllowed()` and `applyCorsHeaders()` — batch's `new URL().origin`
normalisation merged with treashunt's `applyCorsHeaders`, per-entry parsing so one malformed
config value cannot reject every origin, and the opaque `"null"` origin rejected. It replaced
three copies of the allow-list (`app.ts`, `auth.module.ts`'s local `withCors`, the test helper)
and removed the two `.filter(Boolean) as string[]` casts that `AGENTS.md` bans. New
`origins.test.ts`: 17 cases. API suite 30 → 47 pass.

The env names went with it, because the leak **was** the names: `BO_URL` → `SPA_URL` (5173 =
`apps/spa`), `PLAYER_URL` → `SSR_URL` (5174 = `apps/ssr`), across 11 source sites, both blocks of
`apps/api/wrangler.jsonc`, and three more files that were outside the first pass —
`apps/ssr/wrangler.jsonc` (route `play.my-app.com` → `ssr.my-app.com`),
`apps/static/wrangler.jsonc` (`APP_URL` → `https://spa.my-app.com`) and
`.github/workflows/deploy.yml` (dropped the dead `VITE_PLAYER_URL`). Placeholder hosts are now
`spa.` / `ssr.`, consistent with the variable names — without that, production CORS,
`trustedOrigins` and the auth email links point at a host nothing serves.

Zero `BO_URL` / `PLAYER_URL` remain outside `docs/plans/` and the gitignored local `.env` files.

Two leftovers found in passing, neither in scope: `VITE_MARKETING_URL` in
`apps/spa/.env.example` is read by nothing either, and `apps/api/tsconfig.test.json` reports
pre-existing `exactOptionalPropertyTypes` errors in `media.routes.ts` — the same class as the
ones item 1 fixed, so they belong with item 1's follow-up.

### 5. ~~`bun test --isolate` for the API suite~~ → **done 2026-10-29, uncommitted**

keeper runs `bun test --isolate` in `apps/api`. One flag; catches cross-test state leakage in a
suite that shares an in-memory database per test. Add to `apps/api/package.json` now (it is the
080 source) so the `api` module template carries it at extraction. Not **T**: `templates/base`
ships no apps, so there is no `apps/api/package.json` there to put it in.

### 6. ~~`lib/logger.ts` → the six `lib/` fixes~~ → **done 2026-10-29, uncommitted**

Correction after checking: `apps/api/src/lib/logger.ts` and `logger.test.ts` already exist here
and are byte-identical to keeper's (`ebe1577`). batch and treashunt are the ones lagging, on
`console.*` behind `// oxlint-disable no-console`. Nothing to backport.

What to take in its place, all in `apps/api/src/lib/` and all generic
([01](./01-consumers.md) §D.2):

| Fix                                                                                                                                                                                                        | Source        |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| `app.config.ts` spreads `{...cloudflare.env}` / `{...process.env}` before typebox `Default()` writes into it — **we have the mutation bug**, and writing into `process.env` coerces values back to strings | treashunt     |
| `db.config.ts` glob `schemas/*-schema.ts` — the `**.ts` glob picks up `*.test.ts` and `db:generate` dies on `bun:test`                                                                                     | treashunt     |
| `r2.ts`: `encodeURIComponent` per key segment in the public URL, plus `validateKey` (rejects `..`, empty segments, control characters)                                                                     | batch, keeper |
| The `advanced` block in `auth.config.ts` we do not have: `disableOriginCheck: false`, `disableCSRFCheck: false`, `useSecureCookies`, `defaultCookieAttributes`                                             | all three     |
| Dedupe the scrypt `hashPassword` / `verifyPassword` pair, inlined here in both `auth.config.ts` and `db.seed.ts`, into `lib/crypto/password.ts`                                                            | treashunt     |
| Move the hand-written `medias` table out of the **generated** `db.auth-schema.ts` — `auth:generate --output` rewrites that file                                                                            | treashunt     |

### 7. `storage`: `lib/r2.ts` + keeper's `lib/storage.ts` → **M**, two variants

This is the clearest validation of the spec 035 category model in the whole audit. Same category
(`storage`, home `packages/storage`), two providers, selected by `variants[].match`:

`variants[].match` matches on **installed peer modules**, not on prose, so each variant keys on
the `api` module id:

| Variant | Source                                         | `match`                                                                                                                              |
| ------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `r2`    | ours, `lib/r2.ts`                              | `{ api: ["elysia-worker"] }`                                                                                                         |
| `s3`    | `keeper:lib/storage.ts` (`@aws-sdk/client-s3`) | the non-Worker `api` module — **which does not exist yet**, so `s3` has nothing to match until a Bun/Docker `api` module is authored |

Not in the 080 MVP (step 5). Record the pair now so the category lands with two variants rather
than one — a one-variant category is how `adapter` and `variant` got confused in the first place.

### 8. ~~`portless` dev URLs~~ → **done 2026-10-29 as a registry item, uncommitted**

treashunt's `dev:portless` / `dev:lan:portless` give real local HTTPS hostnames and phone testing
without an IP. Zero coupling, one devDependency, two scripts.

It cannot be a `tooling` **module**: spec 035 gives `tooling` `cardinality: one`, so a second
tooling module is a conflict by construction. Two correct homes — an `options` toggle on the one
`tooling` module, or a shadcn-schema `registry:tooling` item in `registry/tooling/`. Prefer the
item: it carries no peers and no variants, and `registry/tooling/registry.json` already exists.
([01](./01-consumers.md) says "item"; that is the one to follow.)

### 8b. The nine keeper findings → **7 of 9 done 2026-10-29, uncommitted**

[01](./01-consumers.md) §C checks keeper's 54 fixed findings against this tree. Nine land on
paths that still exist, each already verified and gated next door. All are on the 080 extraction
path or in `packages/ui`, which the `ui` module hosts — so they get vendored into every generated
project if left alone. Ordered by what they cost if ignored:

| #   | Item                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 | Cost                                |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| 1   | `apps/spa/src/hooks/use-auth-redirect.ts:21` — take keeper's hardened `sanitizeRedirectPath` (resolve against a dummy origin, reject any other origin; covers `/\\host`, `/\t/host`, `//host`). Latent here because the sink is `navigate()`, **not** latent once this code is vendored and someone passes it to better-auth's `callbackURL` — which is exactly what happened in keeper. This repo ships no front tests, so the fix lands untested unless a pure-function test is allowed as an exception — question 8 in the [README](./README.md). | ~15 lines                           |
| 2   | `apps/api/src/modules/test/{app,db}.test.ts` — two helpers named `*.test.ts`, both with **0** test cases. `app.test.ts` is dead outright; `db.test.ts` is live (`createTestDb`, used twice by `media.e2e.test.ts`). Delete `app.test.ts`; rename `db.test.ts` and move it to treashunt's `tests/helpers/*.helpers.ts` convention ([01](./01-consumers.md) §D.4) instead of fixing the name in place. No double registration here, unlike keeper — `db.test.ts` has no tests to re-register.                                                          | delete 1, move 1, update 1 importer |
| 3   | `apps/api/src/modules/db/db.plugin.ts` — delete. `createDbPlugin` has zero references.                                                                                                                                                                                                                                                                                                                                                                                                                                                               | delete 1 file                       |
| 4   | `packages/ui/src/lib/animations.ts` — six `as Transition` casts, which `AGENTS.md` bans. Keeper's fix: one `satisfies Record<string, Transition>` (removing them outright broke `button.tsx` there).                                                                                                                                                                                                                                                                                                                                                 | ~6 lines                            |
| 5   | `packages/ui/src/hooks/use-mobile.ts:18` — `return !!isMobile` on a `useState<boolean>`.                                                                                                                                                                                                                                                                                                                                                                                                                                                             | 1 line                              |
| 6   | `apps/spa/src/hooks/use-session.ts` — the `data as SessionWithActiveOrg` cast, plus one call site using the hook while three call `authClient.useSession()` directly. Not keeper's delete: ours does real typing work. Fix the cast, then make the four sites agree.                                                                                                                                                                                                                                                                                 | ~20 lines                           |
| 7   | `apps/api/src/lib/app.config.ts` — check keeper's SF034: derive `trustedOrigin` once at boot rather than `new URL(config.APP_URL).origin` per request.                                                                                                                                                                                                                                                                                                                                                                                               | ~5 lines                            |
| 8   | `knip.jsonc` + `vite.config.ts` — add a `.claude/worktrees/` ignore **before** using worktrees here, or bare `bun run check` / `bun run knip` break (keeper's SF051).                                                                                                                                                                                                                                                                                                                                                                                | 2 lines                             |
| 9   | Run keeper's `## Coverage` scan list over this tree — cheaper than a sweep, same rubrics.                                                                                                                                                                                                                                                                                                                                                                                                                                                            | one session                         |

Items 2 and 3 are deletions of dead files and can ride item 1's PR.

### 8c. `bg.json` says `version: 1`, spec 020 says it MUST be `2` → **R**

Found while comparing manifests ([05](./05-lonestone.md)):

| Place                                    | Says                                                           |
| ---------------------------------------- | -------------------------------------------------------------- |
| `docs/specs/020-project-manifest.md:56`  | `version` MUST be `2`                                          |
| `packages/schema/project.schema.json:10` | `"version": { "const": 1 }`                                    |
| `templates/base/bg.json:2`               | `"version": 1`, with the v1 `installed` / `capabilities` shape |

Spec 020 is normative and documents the v1 → v2 migration. The schema and the template still
emit v1. Decide which is right before anything writes a manifest for real: a `create` that emits
a manifest its own schema rejects at v2 is a release blocker. Cheap now, expensive after the
first published tag.

### 9. `CHANGELOG.md` + a release gate script → **R**

Spec 070 requires the changelog to list version bumps, items, modules and intention ids per
release, and spec 090 requires human changelog entries beside the intentions. keeper has both a
`CHANGELOG.md` and `scripts/release.ts` validating the release ref against the app version before
anything is built. Take the gate, adapt the payload: we publish npm + a git tag, not a Docker
image. Compare against lonestone's release-please setup — [05](./05-lonestone.md).

### 10. ~~`PRODUCT.md` and `CONTEXT.md` skeletons~~ → **done 2026-10-29, uncommitted**

batch and keeper both carry `PRODUCT.md`; batch carries `CONTEXT.md` as its domain glossary. A
generated project needs both as empty skeletons — the platform's own product file is
`docs/specs/000-product.md` and must not be confused with the consumer's.

### 11. Committed `.claude/settings.json` → **R** + **T**

See [02](./02-conventions-slop.md) Finding 3. Maintainer-side allowlist at the root; a minimal
one shipped from `templates/base`.

## Next — after the MVP extraction is green

| Item                                                        | Dest                     | Note                                                                                                                                                                              |
| ----------------------------------------------------------- | ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin CLI (reset-password, backup, restore)                 | **M** `ops`              | keeper. Generic shape, Postgres-bound body — needs a category that does not exist yet; propose it with the module, per spec 035's rule that a misfit is a signal about the table. |
| `croner` scheduled jobs                                     | **M**                    | keeper on Bun; a Workers cron trigger is the other variant.                                                                                                                       |
| Docker host (`Dockerfile`, `docker-compose.yml`, `deploy/`) | **M** `deploy`           | keeper. The non-Cloudflare `deploy` variant.                                                                                                                                      |
| Durable Objects live module                                 | **M**                    | treashunt `modules/live/`. Real, proven, and domain-shaped — extract the seam (`publishLive`), not the game.                                                                      |
| better-auth macro sets                                      | **M** `auth` + `options` | `admin`, `organizationActive`, `platformAdmin`, `auth: "authoring"` across the three repos. These are `options`, not variants.                                                    |
| API test seam convention                                    | **M** `testing`          | batch `modules/test/*.test.ts` vs treashunt `tests/helpers/*.helpers.ts` — pick one before the registry ships either.                                                             |
| better-auth 1.6 → 1.7 for consumers                         | **I**                    | The destructive auth-schema migration from [04](./04-deps-plan.md) PR 2 is exactly what a migration intention is for. Write it in the release that carries the bump.              |

## Not taking

| Item                                                    | Why                                                                                                                                                                |
| ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `lint-staged`                                           | `bunx vp staged` already covers it. Adding both is two tools for one job.                                                                                          |
| `msw`                                                   | Front tests are out in this repo and in keeper. Shipping the mock library without the tests is dead weight.                                                        |
| Scenario simulations (`test:scenarios`)                 | Treashunt's game scenarios. The _shape_ (simulate a flow end to end) is interesting; there is nothing generic to extract yet.                                      |
| `docs/audits`, `docs/feedback`, `docs/handoffs`         | Session residue, not structure. A generated project does not need empty folders.                                                                                   |
| `.impeccable/`, `.playwright-mcp/`, `.worktrees/`       | Tool state.                                                                                                                                                        |
| A second spec workflow (`.specify` / openspec / chisel) | Three repos, three systems, and the boilerplate's own `docs/specs/` already works. Picking one for the template is README question 1 — a decision, not a backport. |
| Cleaning the legacy apps' 30 unused deps                | They are scheduled for deletion. Clean `apps/api` only (it is the 080 MVP); leave the fronts.                                                                      |

## Cost summary

| Block                      | Rough cost                                                                                                       |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Item 0 (auth singleton)    | one PR, ~1 hour. Do it first — it is the only active defect here.                                                |
| Items 1–3                  | one small PR, under an hour                                                                                      |
| Items 4–8 + 8b             | one PR each; 8b's nine rows fit in two PRs (the security fix and its deletions, then the `packages/ui` cleanups) |
| Item 8c (manifest version) | a decision, then under an hour either way                                                                        |
| Items 9–11                 | one PR, gated on the release-tooling choice in [05](./05-lonestone.md)                                           |
| Next (7 items)             | each rides an 080 extraction step                                                                                |

## Applied on 2026-10-29 — what landed, and what it turned up

Items 5, 6, 8, 10 and seven of 8b's nine rows were applied by three parallel agents.
`bun run verify` exits **0**. The API suite went 47 → **78 pass across 10 files** (30 at the start
of the audit); the whole repo is now **110 tests** reachable from `bun run test`, against 57 when
this folder was written.

**Two premises in this plan were wrong, and the work proved it:**

- **8b#7 (`trustedOrigin` derived at boot) does not apply here.** keeper's SF034 was about
  `new URL(config.APP_URL).origin` parsed per request in four macros. This repo has no `APP_URL`
  and no per-request origin parsing — `grep "new URL(config" apps/api/src` returns nothing outside
  the new `origins.test.ts`. Skipped, correctly. The nearest analogue, `originAllowed` in
  `lib/origins.ts`, re-normalises its two allow-list entries per call **on purpose**: a test
  mutates `config.SPA_URL` at runtime and expects the change to take.
- **8b#6 (`use-session`) was not doing real typing work.** `authClient.useSession()` already
  infers `session.activeOrganizationId` through `inferAdditionalFields<Auth>()` and
  `organizationClient`. The cast, the conditional type and the `?? null` were all redundant. The
  hook is now a three-line pass-through — the thing keeper deleted. Keep or delete is an open call.

**New findings the work surfaced, none of them planned:**

| Finding                                                                                                                                                                                                                                                                                                                                                                                                                      | Why it matters                                                         |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| **`auth:generate` is still destructive.** Moving `medias` out of the generated `db.auth-schema.ts` fixed one case, but `organization.deletedAt` and `organization.settings` are hand-written in that same generated file, and our `organization()` call declares no `schema` or `additionalFields`. A regeneration drops both columns, and `auth.config.ts` and `auth.macro.ts` depend on them. treashunt has the same hole. | The command is documented in `AGENTS.md` as routine                    |
| `docs/TESTING.md:32` and `:59` still cite `modules/test/db.test.ts` and its old import path                                                                                                                                                                                                                                                                                                                                  | The file moved to `tests/helpers/db.helpers.ts`                        |
| Uploading with an empty folder, or one containing `..`, now returns **400** where it used to produce keys like `medias//…`                                                                                                                                                                                                                                                                                                   | A behaviour change, not a pure refactor — intended, but it is a change |
| The POST `INVALID_KEY` → 400 mapping has no test (the route needs auth); the GET one is covered                                                                                                                                                                                                                                                                                                                              | A gap in otherwise mutation-checked work                               |
| The deduped password compare is still a non-constant-time `===`                                                                                                                                                                                                                                                                                                                                                              | Carried over deliberately; `timingSafeEqual` is a follow-up            |
| `defaultCookieAttributes` uses `sameSite: "lax"`, which fits the `spa.` / `ssr.` / `api.my-app.com` production hosts but **would break on `*.pages.dev`** (batch's case, which needs `"none"`)                                                                                                                                                                                                                               | A constraint the wrangler hosts now carry                              |
| The portless registry item's test is run by **nothing** — spec 070 forbids `bun test` from sweeping `registry/`, and the golden projects that should cover it do not exist                                                                                                                                                                                                                                                   | Exactly gap 3 of [06](./06-platform-gaps.md)                           |
| portless's `ssr` wiring is probably incomplete: `API_URL` is a wrangler var there, which a process env value likely does not override under `@cloudflare/vite-plugin`                                                                                                                                                                                                                                                        | Unverified; the item ships anyway                                      |

**Two things I reverted from the agents' work**, both in [04](./04-deps-plan.md)'s territory:

1. The `portless` devDependency and the two `dev:portless` root scripts. They broke
   `bun install --frozen-lockfile`, which is what CI runs, and fixing that by running
   `bun install` would have forced the 94-line lockfile pruning as a side effect of a dev
   convenience. The registry item — the actual deliverable — stays.
2. The root scripts pointed at `registry/tooling/portless/dev-portless.ts`. Spec 070 states that
   `registry/` and `templates/` are **source material, not workspaces**, so the platform repo must
   not depend on its own registry at runtime.

**One gap I closed myself:** `apps/cli/src/create.ts` substituted `{{DISPLAY_NAME}}` only in
`package.json`, `README.md` and `AGENTS.md`, so the new `CONTEXT.md` would have shipped the
literal token into every generated project. It now loops over a list including `PRODUCT.md` and
`CONTEXT.md`, and tolerates a file an older template lacks.

**Still open in this plan:** item 7 (record the storage r2/s3 variant pair in spec 035),
item 8b#9 (run keeper's Coverage scan list), item 8c and item 9 (both your decisions), item 11
(`.claude/settings.json` — I pulled it from the swarm rather than have an agent write a
permission allowlist), and the `bun.lock` workspace name.

## Interaction with the Boilerstone harvest

Both evidence passes have landed: the mechanical skeleton diff is [01](./01-consumers.md) §D, and
the Boilerstone harvest is [05](./05-lonestone.md). Nothing in this plan is still pending on them.

The harvest's five adopted items are spec and CLI work rather than backports, so they belong on
the platform roadmap — but two of them change this plan's shape once done:

- **authoring intentions in the feature PR** means the "better-auth 1.6 → 1.7 for consumers"
  intention in §Next gets written in the PR that does the bump, not at release time;
- **release-please with `extra-files`** replaces the hand-written release gate in item 9.
