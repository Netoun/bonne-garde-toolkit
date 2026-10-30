# 09 — Dissolving the legacy apps into modules

Written 2026-10-30 at `833d2ef`. The go for the dissolution was given the same day.
[08](./08-plan.md) step 3 said "smallest first (`apps/static`)". That contradicts
[080](../../specs/080-existing-code-migration.md), which is normative, so this file replaces it.

**Recommendation: follow 080's order (`tooling`, `ui`, `api` then `web`, `db`/`orm` then `auth`,
`email`/`queue`/`storage`), and delete consumers before the packages they use.** Smallest-first
fails on the code, not only on the spec: `apps/static` imports `@acme/config` and `type App` from
`@acme/api/app` (`apps/static/src/lib/api.ts`), and `apps/ssr` and `apps/spa` add `@acme/ui`. A
`web` module peers on `ui`, `api` and `config`, so those have to exist as modules first.

The legacy workspace edges, from the `package.json` files, set the order of deletion:

```
apps/spa     -> config, ui, api (types)        packages/emails -> config
apps/ssr     -> config, ui, api (types)        packages/ui, config, api-runtime -> nothing
apps/static  -> config, api (types)
apps/api     -> api-runtime, config, emails
```

So `apps/ssr` and `apps/static` go first (stage 3), `apps/spa` next (stage 6), then `apps/api`, then
`packages/*`. 080 step 6 ("delete only after the playground is green for the module that replaces
it") is necessary and not sufficient: a tree with a remaining in-tree consumer stays.

The seven questions at the end were answered on 2026-10-30, and the specs say what was decided, so no stage waits for the user.

## 1. Every piece, one category

080: "every extracted piece MUST be assigned a category from 035 before extraction starts". Module
ids are `<category>/<id>`. Two item names retire (`api-elysia`, `spa-react-router`); nothing
consumes the platform yet (`git tag` is empty), so that costs nothing.

| #   | Piece                                                                                                                                                                                                       | 035 category             | Module id                                                              | Home                       | Replaces                                              | Stage         |
| --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------- | -------------------------- | ----------------------------------------------------- | ------------- |
| 1   | Root `vite.config.ts` (lint rules, fmt, `staged`), `.husky/pre-commit`                                                                                                                                      | `tooling`                | `tooling/vite-plus`                                                    | repo                       | the stub `vite.config.ts` in `templates/base`         | 1             |
| 2   | Host half of `packages/ui`: `package.json`, `tsconfig.json`, `components.json`, `src/styles/*`; and the `package.json` + `tsconfig.json` that item `utils` ships today                                      | `ui`                     | `ui/shadcn`                                                            | package `packages/ui`      | those two files in `utils`                            | 2             |
| 3   | `registry/ui`: `utils`, `button`, `badge`, `card`                                                                                                                                                           | none: UI items (030)     | stay items                                                             | —                          | their `meta.bg`                                       | 2             |
| 4   | The other 26 `packages/ui/src/components/*`, `lib/animations.ts`, `hooks/use-mobile.ts`                                                                                                                     | none: UI items (030)     | new items                                                              | —                          | `packages/ui`                                         | 2             |
| 5   | `registry/lib/config`, `packages/config` (6 tests), root `branding.json`, `scripts/gen-branding.ts`, `assets/favicons`                                                                                      | `config`, added by Q1    | `config/branding`                                                      | package `packages/config`  | all of those                                          | 3, first (Q1) |
| 6   | `registry/modules/provider/cloudflare` (exists), `packages/api-runtime` (6 tests)                                                                                                                           | `provider`               | `provider/cloudflare`                                                  | repo                       | `packages/api-runtime`; its `apps/api/wrangler.jsonc` | 3             |
| 7   | `registry/modules/provider/dockerfile` (exists)                                                                                                                                                             | `provider`               | `provider/dockerfile`                                                  | repo                       | — (fixed, not replaced)                               | 3             |
| 8   | Item `api-elysia`, and the shell of `apps/api`: `index.ts`, `app.ts`, `lib/{app.config,env,origins,logger,eden,slug}`, `modules/test/*`, their tests, `bunfig.toml`, `tsconfig*`                            | `api`                    | `api/elysia`                                                           | app `apps/api`             | item `api-elysia`                                     | 3             |
| 9   | Item `spa-react-router`, and what of `apps/spa` needs neither auth nor a feature: `root.tsx`, `routes.ts`, `lib/{api,utils}.ts`, `providers`, `stores`, `components`, `hooks/{use-init-theme,use-load-app}` | `web`                    | `web/spa`                                                              | app `apps/spa`             | item `spa-react-router`                               | 3             |
| 10  | `apps/ssr` (20 files, 4 tests)                                                                                                                                                                              | `web`                    | `web/ssr` (`peers.provider: ["cloudflare"]`, Q7)                       | app `apps/ssr`             | `apps/ssr`                                            | 3             |
| 11  | `apps/static` (18 files, 1 test)                                                                                                                                                                            | `web`                    | `web/static`                                                           | app `apps/static`          | `apps/static`                                         | 3             |
| 12  | `apps/api/src/modules/db/db.{client,service,module}.ts`, the `DB` binding in `lib/env.ts`                                                                                                                   | `db`                     | `db/d1` (`peers.provider: ["cloudflare"]`)                             | package `packages/db`      | —                                                     | 4             |
| 13  | `db.config.ts`, `schemas/db.core-schema.ts`, `migrations/`, `drizzle/seed.sql`, `db.seed.ts`, `tests/helpers/db.helpers.ts`                                                                                 | `orm`                    | `orm/drizzle`                                                          | package `packages/db`      | —                                                     | 4             |
| 14  | `apps/api/src/modules/auth/*`, `lib/crypto/password.ts`, generated `db.auth-schema.ts`                                                                                                                      | `auth`                   | `auth/better-auth`                                                     | package `packages/auth`    | —                                                     | 4             |
| 15  | `lib/r2.ts`, `modules/media/*` (9 files), the `medias` table                                                                                                                                                | `storage`                | `storage/r2` (`peers.provider: ["cloudflare"]`, `peers.db`)            | package `packages/storage` | —                                                     | 5             |
| 16  | `packages/emails` (12 files, 2 tests), `apps/api/src/lib/email.ts`                                                                                                                                          | `email`                  | `email/resend`                                                         | package `packages/email`   | `packages/emails` (035 says `email`, no `s`)          | 5             |
| 17  | `apps/spa/src/features/*` (33 files), `lib/auth.ts`, `hooks/{use-auth-redirect,use-session}.ts` (36 of the 57 files of `apps/spa`)                                                                          | none: feature items (Q3) | items in `registry/features`                                           | —                          | `apps/spa`                                            | 6             |
| 18  | `.github/workflows/deploy.yml`                                                                                                                                                                              | `deploy`                 | `deploy/cloudflare-actions` (`peers.provider: ["cloudflare"]`)         | repo                       | —                                                     | 6             |
| 19  | `registry/tooling/portless`                                                                                                                                                                                 | `dev`, added by Q2       | `dev/portless`                                                         | repo                       | the item                                              | 6 (Q2)        |
| 20  | `queue`, `payments`                                                                                                                                                                                         | —                        | nothing in the legacy tree to extract; 080 step 5 names `queue` anyway | —                          | —                                                     | —             |

Notes on rows that are not obvious:

- Rows 8, 14, 15 and 16 split `apps/api/src/lib/env.ts` and `app.config.ts`. `app.config.ts` today
  requires `BETTER_AUTH_SECRET`, `R2_PUBLIC_URL` and `RESEND_API_KEY`, which would make the `api`
  shell unbootable without auth, storage and email. The shell keeps its own keys (`API_URL`, the
  origins); each module validates its own at its own seam.
- The root `testing/` (3 files) is used only by the three fronts through `../../testing/`. It has
  no row: each `web` module ships the setup it needs (`frontend.setup.ts`, `matchers.d.ts`; `server.ts`
  only for `ssr`). `testing` is app-homed, `testing/` is repo-level, and three small copies are
  cheaper than a rule.
- Row 17 is 36 of the 57 files of `apps/spa`; `lib/auth.ts` and the two hooks import the auth client, so they wait for `auth`. 035 forbade module source in `apps/*/src`, and 030 pointed items at
  `packages/ui`, so neither catalog fitted; Q3 added feature items to both.

What is **deleted, not extracted**, so it has no category: `scripts/init.ts` and
`.bonnegarde-init.json` (010 forbids init leftovers; `bg create` + `bg add` + the modules' `env`
replace it), `scripts/brand.ts` (`bg create` renders `{{SCOPE}}`), `apps/api/.dev.vars.example` and the root `.env.example` (the
modules' `env` entries), `tsconfig.base.json` (its `paths` reach into other trees' `src`; modules
use `exports`), the per-app overrides in the root `vite.config.ts`, the per-app entries of
`knip.jsonc`, and the `*:legacy` scripts of the root `package.json`.

## 2. The couplings to settle

### (a) What `tooling` is

035: `tooling` is `one`, home repo, "fmt / lint / check / hooks". 010 puts the stubs in the base
template (`fmt`, `lint`, `check`, a Husky prepare hook). So `tooling` is the quality gate: the Vite+
config (lint rules, fmt options, `staged`) and the git hook that runs it.

**`config` and `portless` do not become it.** `config` is a runtime package: `branding` is imported
by `api`, `emails` and every front. `portless` is a dev launcher hard-wired to four app keys
(`AppKey = "api" | "spa" | "ssr" | "static"`). `tooling` is `one`, so `bg add portless` after
`bg add tooling` would be refused with "use `bg replace`", which is the wrong answer. Each gets a
category of its own, added to 035 by Q1 and Q2. `tooling/vite-plus` is new, extracted from the root files.

**The shape is forced by "no `--force`".** `create` leaves base's `vite.config.ts` on disk and
unrecorded in `bg.json`, and `stageModules` calls an existing, unrecorded, differing file a
collision. So base must not ship what the module ships:

- Base drops `vite.config.ts`. Probed 2026-10-30: in a `create` + `add button badge card` project
  with no config, `bun run check` passes on Vite+ defaults.
- Base keeps 010's stubs and gains the one it lacks: the `husky` devDependency and
  `"prepare": "husky"`. `husky` with no `.git` prints "`.git` can't be found" and exits 0
  (checked with `bunx husky@9.1.7`), so `create --no-git` still installs.
- The module copies `vite.config.ts` and `.husky/pre-commit` (`bunx vp staged`) and declares no
  dependencies: a repo-homed module needs an explicit `workspace` to declare any, and a root
  `package.json` edit is a patch, which `add` refuses. `knip` waits for `scripts.merge` (stage 3).

Files: `templates/base/{vite.config.ts,package.json}`, `registry/modules/tooling/vite-plus/**`.

### (b) The `meta.bg` coupling

`packages/registry/src/resolve-plan.ts` reads `item.meta.bg` in `itemCapabilities()`: `provides`
feeds `plannedCaps` (since `af4352d` derived from the catalog entries of the installed items, because
020 dropped the `capabilities` field), `requires` is checked against it, `conflicts` is checked
(no catalog item uses it), `transforms` is collected and read by nothing, and `InstallPlan.capabilities`
is printed in the `add` output (`cli.ts:187`).

**The break:** `button`, `badge` and `card` provide `ui`, and `spa-react-router` has
`requires: ["config", "ui"]`. Strip `meta.bg` from the UI items alone and `bg add spa-react-router`
fails with `item spa-react-router requires capability ui`, although its `registryDependencies`
already pull `button`.

Every `requires` in the catalog repeats a `registryDependencies` edge (`utils`; `config`, `button`),
so nothing live is lost. **Recommendation: strip `meta.bg` from the whole catalog in one commit**
(UI, apps and lib: nothing reads `provides: api | spa | config` or `transforms`), delete `BgMeta`,
`itemCapabilities`, `plannedCaps`, `InstallPlan.capabilities` / `transforms` and the `capabilities`
key of `add`'s output, and move the one rule with content to where 030 and 020 put it: **an item
with a file target under `packages/ui/` fails unless `manifest.modules.ui` has a record or a `ui`
module is named in the same call.** The message names the module: "`button` needs the `ui` module;
`bg add ui/shadcn`" (030 acceptance). Item to item stays `registryDependencies`; module to module
stays `peers`. A module never depends on an item (no field, and 030 forbids one), so `web/spa`
drops its `Button` import.

Files: `packages/registry/src/{resolve-plan.ts,types.ts}`, `packages/cli/src/cli.ts`,
`registry/{ui,apps,lib}/registry.json`; tests `resolve-plan.test.ts` (three assertions on
capabilities), the `capabilities: []` and `transforms: []` fixtures in `apply-plan.test.ts` and
`apply-module.test.ts`, the v1 fixture at `create-add.test.ts:266`, and
`registry-contract.test.ts`, which gains 030's "no item carries `meta.bg`". `utils` also stops
shipping `packages/ui/package.json` and `tsconfig.json` (030: items do not create the host
package), which closes 07's loose end about its `^` ranges.

### (c) Who owns `packages/api-runtime`

The facts: `api-elysia` ships `apps/api/wrangler.jsonc`, and so does `provider/cloudflare`, so
`bg add cloudflare` after it fails without `--force`. `provider/dockerfile` writes
`packages/api-runtime/src/index.ts` and no `package.json`, so the directory is not a workspace.
`api-elysia`'s `apps/api/src/index.ts` never imports `api-runtime`. On `create` + `api-elysia` +
`dockerfile`, `docker build` fails (no SPA workspace) and `doctor --strict` is green.

**Recommendation: the provider owns `packages/api-runtime` whole** (`package.json`, `tsconfig*.json`,
`src/index.ts`, tests), as the one `default` variant of each provider module. `api` ships none of it.

035 says `api` MUST ship one variant per provider, and that is the obvious home. It cannot hold
this file: a module has one `template/` tree that mirrors the target tree with no per-file target,
so two variants of `api` cannot both carry `packages/api-runtime/src/index.ts`. Two provider
modules can, because `provider` is `one` and only one is ever installed. That is how `dockerfile`
already works.

- **Which variants:** `cloudflare` is `packages/api-runtime` as it is today (`783d331`:
  `CloudflareAdapter`, `readRuntimeEnv` over `cloudflare:workers`, `serve` returning `{ fetch }`),
  so `provider/cloudflare` gains the copy it lacks (07: "swapping back has nothing to restore").
  `dockerfile` is `75e91fd` as it is.
- **Who ships `package.json`:** the provider, vendored per (e): `exports["."]` and the `typecheck` /
  `test` scripts, no dependency maps; the variant's `workspace` is
  `{ name: "{{SCOPE}}/api-runtime", path: "packages/api-runtime" }` and its dependencies merge in.
- **The `api` thin entry** (035 allows it since `aad1c96`): `apps/api/src/index.ts` is
  `import { serve } from "{{SCOPE}}/api-runtime"; import { app } from "./app"; export default serve(app);`,
  and `app.ts` is `new Elysia(runtimeOptions)`. `apps/api/package.json` depends on
  `{{SCOPE}}/api-runtime: workspace:*`; the module declares `peers: { provider: [] }`. That is the legacy
  shape at `783d331`.
- **Fixes the docker gap:** the Dockerfile's `RUN bun run --filter '{{SCOPE}}/spa' build` is what
  assumes an SPA workspace. `serve` already tolerates a missing `build/client` (`builtFile` returns
  `null`), so the Dockerfile builds with the root `bun run build`.
- **`doctor --strict` stays green on a broken image**, because it checks recorded paths only
  (settled in 07). Catching that class is golden's job: a second run with `provider/dockerfile`
  that goes through `docker build`, and a golden that runs the `checks` each module declares,
  which `add` only prints (050 step 15).

Cost: a repo-homed provider writes a package under `packages/`. 035's seam rule binds only
package-homed modules, so it is allowed, and 035's `provider` Note now says so (Q4).

### (d) Provider files inside app-homed items

**Rule: provider modules write nothing under `apps/*`.** A file that exists for one provider and
lives in an app is a payload of the app module's variant for that provider. `api`'s `cloudflare`
variant copies `apps/api/wrangler.jsonc`; its `dockerfile` variant does not list it. `web/spa`'s
`cloudflare` variant copies `apps/spa/wrangler.jsonc` (a Pages config). Variants differing by which
paths they list is something a mirrored template can express; variants differing by content at one
path is not, which is why (c) goes the other way.

Why not the provider: it cannot know `web` app ids (`web` is `many`); it is first in 035's order,
so its files would land before the app exists and leave an orphan `apps/api/wrangler.jsonc`; and
035 says only variant payloads differ per provider. The collision disappears by construction.

- **Scripts:** `dev` and `deploy` (`wrangler dev`, `wrangler deploy`) differ per variant at one path,
  `apps/api/package.json`. Each variant carries a `scripts.merge` patch, and `wrangler` is in the
  variant's `devDependencies`. That is stage 3's one patch type.
- **Composition:** later, `db/d1` and `storage/r2` `jsonc.merge` `d1_databases` and `r2_buckets`
  into `apps/api/wrangler.jsonc`, which also gives that file region owners.
- **Spec:** `web` joins `api`, `db`, `storage` and `deploy` in "MUST declare `peers.provider`"
  (06 unresolved 1).
- **Cost:** replacing a provider has to re-select the variant of every module that matched on it.
  050 defines `replace` for one category and says nothing about dependents. `bg replace` is refused
  today, so the sentence can wait until it is built.

### (e) Found while reading: a module cannot ship a usable `package.json`

`generatedPackageJson` in `module-plan.ts` writes `name`, `version`, `private`, `type` and the
dependency maps: no `exports`, no `scripts`. `planModule` refuses a module that also vendors that
path. The proof it matters is already in 08: removing `./components/*` from `registry/ui/package.json`
fails golden at typecheck, and a generated `packages/ui/package.json` would drop every subpath and the
`typecheck` / `test` scripts.

**Recommendation: a module vendors its `package.json` without dependency maps, and the planner merges
the variant's `dependencies` / `devDependencies` into it instead of refusing.** It satisfies both
sentences of 035 (a dependency is declared once; the maps come from the variant, not from a hand-written
file) with one planner change in `packages/registry/src/module-plan.ts`. It is the first commit of
stage 2, because `ui/shadcn` is the first module that needs it. 035 now states it (Q4).

## 3. Stages, in 080's order

**Golden, for every stage.** Today it installs items only: `scripts/golden-project.ts` reads
`bg list`, which prints items only, because golden runs `bg add` on every line it prints. It starts
adding modules in stage 1, so the module path (`5aa660e` to `833d2ef`) is covered beyond unit tests.
Because two `provider` modules cannot both be installed, modules come from an explicit list, guarded
like `EXCLUDED` (a module under `registry/modules` that is not listed fails the run). From stage 3
golden installs exactly one provider, `cloudflare`; `dockerfile` is covered by the second run of
stage 3. When a module replaces an item (`api-elysia`, `spa-react-router`), remove the item from the
catalog in that commit, or golden installs both and collides. `--force` is never passed. `bun run
verify` exits 0 at every commit, and legacy tests keep running until their tree is deleted.

### Stage 1: `tooling` (080 step 1). Waits for nothing.

**Done 2026-10-30** (`ff73081`, `c1c2b5b`, `0d5d7eb`, `d69f4d0`, `0c862a2`; CI run 41052607189). Golden installs `tooling/vite-plus` with no `--force`, then runs `bun run check` and the module's `checks` (total about 11s). Two things the plan below got wrong: an empty base fails `vp check` with "No files found to lint" once `vite.config.ts` is gone, so base's `lint` and `check` take `--no-error-on-unmatched-pattern`; and the three dropped `lint.overrides` are not legacy-only, since generated code lands at 035's homes, so stage 2 re-adds them keyed on those homes. `bg list` now prints modules (`<category>/<id>\tmodule\t…`), takes `--items` and `--category`, rejects unknown arguments, and lists no modules from a `github:` source (raw HTTP has no directory listing).

- **Scope:** `registry/modules/tooling/vite-plus/` (`module.json`, README, `template/vite.config.ts`,
  `template/.husky/pre-commit`, `checks: ["bun run check"]`); base alignment per (a); `bg list` prints
  modules and takes `--items` and `--category` (050); golden takes modules from its list, then runs
  `bun run check` and each module's `checks`.
- **Deletes:** nothing. The root `vite.config.ts`, `.husky/` and `knip.jsonc` serve this repo itself;
  only the per-app overrides leave, with their apps (stage 6).
- **Accept:** `bun run golden` installs `tooling/vite-plus` with no `--force`, and typecheck, test,
  build and `doctor --strict` are green; `bun run check` is green in the golden project; `git ls-files
templates/base | grep vite.config` prints nothing; `bg list --items` prints what it printed before.
- **Size:** about 12 files.

### Stage 2: `ui` and the UI items (080 step 2).

**Done 2026-10-30** (`a180d67`, `dfe1d1e`, `c0cd840`, `08f3fbc`, `fe7992a`, `391a8d6`, `daf604f`). Golden installs `tooling/vite-plus`, `ui/shadcn` and all 32 items in one `bg add` with no `--force`, after a `refuse` phase that proves `bg add button` alone fails with `bg add ui/shadcn button` (total about 17–21s). Where the plan below was wrong: `button`, `badge` and `card` were MVP stubs, not the legacy files, and the other 26 components did not typecheck against them (`size="icon-sm"`), so they were replaced by the legacy files byte for byte, with `lib/animations` landing beside them; the dependency union also needed `react`, `react-dom` and `@types/react`; the host package needed `./hooks/*` in `exports`, the `DOM` lib, and one `src/env.d.ts` so `tsc` has a file. The re-added React lint override names five `react/*` rules at `error`: adding the plugin alone enables none, so the old root override (still in this repo's own `vite.config.ts`) was a no-op.

- **Scope, in commits:** (1) the planner merges variant dependencies into a vendored `package.json`
  (e); (2) `registry/modules/ui/shadcn/` with `packages/ui/{package.json,tsconfig.json,components.json}`
  and `src/styles/*`; (3) `meta.bg` out of the catalog, the `modules.ui` check in, `utils` stops
  shipping the host files (b); (4) the other 26 components, `lib/animations.ts` and
  `hooks/use-mobile.ts` as `registry:ui` items.
- **Dependencies:** the host declares the union its catalog needs (`@base-ui/react`, `vaul`,
  `lucide-react`, `motion`, `tailwindcss-animate`, `class-variance-authority`, `clsx`,
  `tailwind-merge`, `tailwindcss`), pinned exactly. 030 wants item dependencies merged per item,
  which needs a patch; it waits for stage 4. Cost: a project with `ui` installs about nine
  packages it may not use.
- **Deletes:** nothing. `apps/spa` and `apps/ssr` import `@acme/ui`, and the other 26 components
  exist only there. `packages/ui` goes in stage 6, after `apps/spa`.
- **Accept:** `bun run golden` installs `ui/shadcn` and every item from `bg list --items` in one
  call with no `--force`, and typecheck, test, build and `doctor --strict` are green; `bg add button`
  in a fresh project fails naming `ui/shadcn` (a test in `resolve-plan.test.ts` and
  `create-add.test.ts`); `grep -rn '"meta"' registry/*/registry.json` prints nothing, and
  `registry-contract.test.ts` pins it.
- **Size:** about 50 files in four commits: module 9, items 27, the `meta.bg` change 9, planner 3.

### Stage 3: app shells, `api` then `web` (080 step 3).

**Commits 1–2 done 2026-10-30** (`d2d942d`..`2b2a45f`). `config` and `dev` are categories in `packages/schema`. `config/branding` replaces the `config` item and adds root `gen:branding` through `scripts.merge`, the first tier-2 patch (`jsonc-parser` 3.3.1, exact; the packed CLI is no longer zero-dependency): each key is a region `regions["package.json"]["scripts.<key>"]`, an outcome in `bg add` JSON and `failedPatches`, and golden has a `re-add` phase that requires every patch `skipped` and the tree byte-identical. `doctor` checks a patched file region by region (Q5). Where the plan was wrong: 035's seam rule moved `branding.json` and `gen-branding.ts` into `packages/config/`; the `@acme/assets/*` alias cannot ship, so favicons are `{{SCOPE}}/config/assets/favicons/…`; the 7 binary favicons are **not carried** (templates are UTF-8 only), so stage 6 must not delete `assets/` until templates can carry bytes. `spa-react-router` keeps importing `@acme/config` through a transitional import-keyed rule (`MODULE_FOR_IMPORT` in `resolve-plan.ts`), to remove when `web/spa` lands. A failed patch is reported and fails `doctor --strict`, but its conversion into a pending intent (050 steps 11 and 14) is **not built**. **Commits 3–4 done** (`d1ddaac`..`146ada0`): both providers own `packages/api-runtime` (workspace `{{SCOPE}}/api-runtime`) and write nothing under `apps/`; the dockerfile image builds with the root `bun run build` (observed: `docker build`, healthy, `/health` and `/openapi` 200). `api/elysia` is the shell, one variant per provider (`cloudflare` adds `wrangler.jsonc` and `dev`/`deploy` via `scripts.merge`; `dockerfile` adds `dev`), `peers: { provider: [], config: ["branding"] }`, `exports` `.`, `./app`, `./lib/*`; legacy `app.ts` lost the `db`, `auth` and `media` wirings, and an insertion comment marks where a future `ts.elysiaUse` patch adds `.use()`. `app.config.ts` and `env.ts` had to be split, not extracted as-is: the `R2_PUBLIC_URL`, `BETTER_AUTH_SECRET`, `RESEND_API_KEY`, `DB` and `BUCKET` keys wait for stages 4–5, and the providers' env entries and the dockerfile secret generation are orphaned until then. Golden has a second, `dockerfile`, configuration. `doctor` checks a patched file by region only, while `add` still refused an edit outside the regions as a file-level collision; the user chose the region (07's settled list), built in 4a. **Commit 5 and the deletions done** (`79b6a4e`..`4876f41`, CI run 41079457060): `web/spa` (both providers), `web/static` and `web/ssr` (cloudflare only) replace the `spa-react-router` item, `registry/apps/` and the `MODULE_FOR_IMPORT` rule; `apps/ssr` and `apps/static` are deleted with their deploy jobs. Golden installs `provider/cloudflare tooling/vite-plus config/branding ui/shadcn api/elysia web/spa web/ssr web/static` and `provider/dockerfile … api/elysia web/spa` with no `--force` (34 s); removing `./lib/*` from `api/elysia`'s `exports` fails it at typecheck in all three fronts. `docker build` of the dockerfile project with `web/spa` was observed by hand (`/health`, `/`, assets, deep links); **3d done** (`7a45e05`..`21d3b94`, CI run 41083935734): golden's `dockerfile` configuration builds the image and runs it (`/health`, `/`, a hashed asset, a deep link), skips with a line when docker is unavailable, and fails instead under `GOLDEN_REQUIRE_DOCKER`, which CI sets (docker build 43 s in CI, golden 103 s); `pages_build_output_dir` is `build/client`, pinned by a contract test. Where the plan was wrong: the API shell has no `/v1` group, so the fronts export `api`, not `apiV1` (stage 6's `organization-settings-page.tsx` expects `apiV1`); `apps/static` needs `ui` (its `app.css` imports the host stylesheet); the `ui` host exports `./globals.css`, not `./styles/*`; row 9's `theme-toggle` imports two UI items and stays in `apps/spa` (a module never depends on an item); `root.tsx` and `routes.ts` are rewrites, because the legacy ones need the auth hooks and feature routes, so stage 6 puts `useSession`/`useAuthRedirect` back through a patch type 060 does not have yet, or an intent; `testing/frontend.setup.ts` imports MSW, so only `ssr` ships `server.ts`. Deviations: `tooling/vite-plus` does not gain `knip` (it needs a root devDependency, and neither `scripts.merge` nor a module workspace can declare one); `registry/tooling/portless`, `scripts/{brand,init}.ts` still name `apps/ssr`/`apps/static` (guarded by `existsSync`, stage 6).

- **Scope, in commits:**
  1. `config/branding` (Q1). The shells need it: a module cannot require an item.
  2. `scripts.merge`, the first patch (`jsonc-parser`, idempotency test, first `regions`), with
     the answer to Q5.
  3. The providers per (c) and (d): `provider/cloudflare` gains `packages/api-runtime` and loses
     `apps/api/wrangler.jsonc`; `provider/dockerfile` gains its `package.json` and builds with the root `build`.
  4. `api/elysia`: shell only, thin entry per (c), per-provider variants per (d). Item `api-elysia` removed.
  5. `web/spa`, `web/static`, `web/ssr`. Items `spa-react-router` removed. Fronts reach `api` through
     `type App` and `lib/eden`, so each declares `peers.api` and the `api` module lists those
     subpaths in `exports`: legacy resolves them through tsconfig `paths` into the source tree, and a
     missing subpath is the regression class C1 exists for. `tooling/vite-plus` gains `knip`.
- **Deletes:** `apps/ssr` and `apps/static`, once golden is green with `web/ssr` and `web/static`
  installed and `git grep -n '@acme/ssr\|@acme/static'` finds nothing; `registry/apps/`. Not `apps/api`
  (the source of the slices of stages 4 and 5, and `apps/spa` imports its types) and not `apps/spa`
  (its 33 feature files wait for `auth`).
- **Accept:** `bun run golden` installs `provider/cloudflare api/elysia web/spa web/ssr web/static`
  with the earlier stages' modules, with no `--force`, and typecheck, test, build and `doctor --strict`
  are green; `git grep -n wrangler registry/modules/provider` finds nothing under `apps/`; a second
  golden run installs `provider/dockerfile api/elysia web/spa` and goes through `docker build`
  (skipped, and said so, when `docker` is absent); golden's `bun run test` runs the moved tests: the
  api shell's six test files, `ssr`'s 4 and `static`'s 1.
- **Size:** about 100 files in six commits: providers 8, `api` 30, `spa` 14, `ssr` 20, `static` 18, `config` 8.

### Stage 4: `db` and `orm`, then `auth` (080 step 4). Waits for nothing new.

**4a, the patch engine, done 2026-10-30** (`e522cf5`..`a54e3e5`, CI run 41088259501): `jsonc.merge` (an array is a leaf), `ts.addImport`, `ts.addNamedExport` and `ts.elysiaUse` on ts-morph 28.0.0 (one file in memory, insertion by position, every patched file proven formatter-stable by running `vp fmt` in tests); a failed patch becomes a pending intention `<category>/<module-id>/patch-<type>-<file>-<first region>`, recorded on the patch in `bg.json`, staged in `.bg/add/`, reported by `doctor`, closed by `bg record`, and it withholds the module's `checks`; `add` classifies a file with regions by region and keeps it (the user's answer, 07). 060 gained one sentence per behaviour. Debt: ts-morph adds about 15 MiB to the packed CLI and about 100 ms to every command (imported eagerly); `imports[<specifier>]` is one region per specifier, so two modules importing from one specifier into one file conflict; a failed `ts.elysiaUse` leaves its `ts.addImport` unused and lint red until the intention is resolved; `jsonc.merge` into a `package.json` appends where the formatter sorts; presence patches (`ts.*`) are never user-owned, so 060 Acceptance 3 holds only for value regions; `session.md` is not rewritten once nothing is pending; 050 step 15 (`add` runs `checks`) is still not built; 065's "staging refuses a dirty worktree" contradicts 060's "MUST NOT abort"; a variant's `intent: string[]` and a patch's `intent: string` share a name.

**4b, `db/d1` and `orm/drizzle`, landed but not wired, 2026-10-30** (`9fd2d1c`..`424ae79`): both live in `packages/db`; `db/d1` (`peers.provider: ["cloudflare"]`) owns the workspace and its `package.json`, the binding (`readD1()`, lenient when unbound so the shell's `/health` test still passes) and `d1_databases` in the API's `wrangler.jsonc` (`jsonc.merge`); `orm/drizzle` (variant `d1`) ships the client (`createDB`, `dbModule`), an empty schema barrel, `drizzle.config.ts` and an async `createTestDb` that builds tables from the schema. Golden generates a migration, applies it to a local D1 and reads it back; the golden project runs 12 db tests (3 on Miniflare D1, 3 on `bun:sqlite`). Where the plan was wrong: `db.{client,service,module}` are the ORM's, not the binding's; `db.core-schema.ts` is only `medias` (storage's, row 15); the seed is auth's. **Open, in 4b2:** no patch could write `{{SCOPE}}/db: workspace:*` into `apps/api/package.json`, so nothing is wired; the user added `package.dependencies` to 060's catalog and confirmed `{{SCOPE}}` rendering in a patch's declared arguments (`5dd6c28`). `orm` adds its dependencies to `packages/db/package.json` through `jsonc.merge` as a bridge (`drizzle-kit` is a dependency only to sort last). Engine defect: after one `bg add db/d1 orm/drizzle`, re-adding `db/d1` alone is refused. The barrel stays, with a db↔auth workspace cycle: legacy `media.service.ts` runs relational queries across auth and media tables.

- **Scope:** the TypeScript patches on `ts-morph`: `ts.addImport`, `ts.addNamedExport`,
  `ts.elysiaUse`, plus `jsonc.merge` (item dependencies per 030, and `d1_databases` in
  `wrangler.jsonc`). `db/d1` and `orm/drizzle` share `packages/db`; `auth/better-auth` is
  `packages/auth` with `options.withOrg`.
- **Watch:** tables are module-owned (`auth` its generated schema, `storage` the `medias` table),
  re-exported from the `orm` barrel by `ts.addNamedExport`; the 0000 migration mixes both, so
  modules ship schemas, not SQL, and golden gains a phase that runs `db:generate` and applies it to
  a local D1. Fix `auth:generate` (07 loose end: it drops two hand-written `organization` columns)
  before extracting, or every consumer inherits the hole.
- **Deletes:** nothing. `apps/api` still hosts storage and email and is still imported by `apps/spa`.
- **Accept:** `bun run golden` installs `db/d1 orm/drizzle auth/better-auth` with the earlier
  modules, with no `--force`, and typecheck, test, build and `doctor --strict` are green; the auth
  tests run against real SQLite inside golden; `bg add auth/better-auth` without `orm` fails naming
  it (035 acceptance).
- **Size:** about 70 files: engine 12, `db` 14, `orm` 12, `auth` 22, tests that travel.

### Stage 5: `email`, `queue`, `storage` (080 step 5). Waits for nothing new (no `EMAIL` binding, settled in 07).

- **Scope:** `storage/r2` (row 15) and `email/resend` (row 16, renamed `emails` to `email`). `queue`
  has nothing to extract. The `cloudflare` email adapter is the `EMAIL` binding AGENTS.md forbids,
  so it does not ship (settled in 07); the adapters are `memory` and Resend.
- **Watch:** `email` comes after `auth` in 035's order, so it wires itself into `auth` (a patch on
  a known seam, else the first tier-3 intent), never the reverse.
- **Deletes:** nothing yet, for the same reason as stage 4.
- **Accept:** `bun run golden` installs the full backend set (`provider/cloudflare api/elysia db/d1
orm/drizzle auth/better-auth storage/r2 email/resend`) with no `--force`, and typecheck, test, build
  and `doctor --strict` are green; the media route tests run in golden.
- **Size:** about 32 files: `storage` 14, `email` 16, wiring 2.

### Stage 6: what 080 does not list, then the deletions.

- **Scope:** the feature items (row 17); `deploy/cloudflare-actions` (row 18); `dev/portless` (row 19).
- **Deletes, in this order, each after golden is green for its replacement and `git grep` shows no
  in-tree consumer:** `apps/spa`, then `apps/api`, then `packages/{ui,emails,api-runtime,config}`,
  then `testing/`, `assets/`, `scripts/{init,brand,gen-branding}.ts` with their tests,
  `.bonnegarde-init.json`, `tsconfig.base.json`, `registry/{apps,lib,tooling}/`, the per-app entries of
  `knip.jsonc`, the overrides of `vite.config.ts`, the `*:legacy` scripts of `package.json`, and the
  legacy section of `AGENTS.md`; regenerate `docs/ARCHITECTURE.md` and `docs/COMMANDS.md` with
  `bun run gen:architecture` and `bun run gen:commands`.
- **Accept:** `bun run golden` installs every module and item the registry ships, with one provider
  and no `--force`, and typecheck, test, build and `doctor --strict` are green; the golden project
  runs at least 110 tests (the legacy total at `833d2ef`: api 87, api-runtime 6, config 6, emails 2,
  spa 4, ssr 4, static 1); `ls apps packages` shows only what the platform itself needs;
  `bun run verify` exits 0 with no `*:legacy` script.
- **Size:** features about 45 files added; about 170 deleted (`apps/spa` 57, `apps/api` 51,
  `packages/ui` 38, `emails` 12, `config` 7, `api-runtime` 5) and about 12 edited.

## 4. Risks worth a line

- **The 87 `apps/api` tests stop running in-tree.** A module's template imports packages that exist
  only after install, and 070 forbids sweeping `registry/`, so golden's `bun run test` is the only place
  they run. Each stage's Accept pins the count; do not delete a legacy test file before golden runs
  its copy.
- **The first patch changes what `files` means.** After `scripts.merge` edits a file a module
  vendored, its recorded sha256 no longer matches and `doctor` reports it modified. 060 now says a file with recorded regions is checked by region, and `doctor` skips its sha check (Q5).
- **Six months out,** the `api` module and the providers are the part that rots: the `api` thin
  entry, the provider's `api-runtime` and the `wrangler.jsonc` of the `api` variant have to move
  together, and only golden notices when they do not.

## 5. Questions for the user

1. **`config` has no category.** `packages/config` is `branding` constants (`displayName`,
   `publicOrigin`, `supportEmail`, `legalName`) imported by `api`, `emails` and every front, plus the
   favicons. Recommend: add `config` to 035, `one`, home package `packages/config`, no peers, ordered
   after `tooling`. The alternative is dissolving it into `{{DISPLAY_NAME}}` at render time, which
   needs four more fields in `bg.json` and breaks 080's "no feature rewrites". **Answered 2026-10-30: recommendation accepted.** Specs `627dc3e`: 035's table, 080 step 1.
2. **`portless` has no category.** `tooling` is `one` and is the gate, not a launcher. Recommend:
   add `dev`, `many`, home repo. The alternative is deleting the item, which is a feature removal
   and hard-wired to four app keys anyway. **Answered 2026-10-30: recommendation accepted.** Specs `627dc3e`: 035's table.
3. **The 33 front feature files fit neither catalog.** Recommend: `registry/features` (it exists,
   empty, and the root registry already includes it) holds tier-1 items targeting
   `apps/<web>/src/features/**`; amend 030 to allow it, and fail without the `auth` module exactly as
   a UI item fails without `ui`. The alternative is shipping shells with no backoffice pages. **Answered 2026-10-30: recommendation accepted.**
   Specs `627dc3e`: 030 (item kinds, the `auth` rule), 035's seam rule, 080's category assignment.
4. **Four sentences in 035.** Recommend all of them; each is one line.
   (i) A vendored `package.json` MAY carry `exports` and `scripts` but no dependency maps; the planner
   merges the variant's maps (e).
   (ii) A variant selects among files at distinct paths; a file every provider ships but that differs
   per provider belongs to the provider module, or to one module per implementation (`db/d1`,
   `db/libsql`) with a `peers.provider` allow-list (c).
   (iii) The `provider` Note adds "owns the runtime seam packages other categories import" (c).
   (iv) `web` joins `api`, `db`, `storage`, `deploy` in "MUST declare `peers.provider`" (d).
   **Answered 2026-10-30: recommendation accepted.** Specs `627dc3e`: 035 (the vendored `package.json` bullet and the variant bullet, the `provider`
   Note, the `peers.provider` rule), 050's dependency bullet.
5. **A patched file and its sha256.** Recommend: a file with recorded regions is checked by region,
   and `doctor` skips the sha check for it. **Answered 2026-10-30: recommendation accepted.** Specs `627dc3e`: 060 (Checksums, conflict
   policy), 050 (`doctor`).
6. **06 §4 says restructure `packages/ui` at step 2** (`primitives/`, `layouts/`, `patterns/`).
   Recommend not: it rewrites paths in the 20 legacy files that import `@acme/ui` and in the shipped
   `web/spa` shell for no behaviour change, and a `components.json` alias makes it a one-line registry
   change afterwards. **Answered 2026-10-30: recommendation accepted.** Specs `627dc3e`: nothing to amend, no spec asks for the restructure.
7. **`web/ssr` declares `peers.provider: ["cloudflare"]`.** It carries `workers/app.ts`,
   `cloudflare-context.ts` and `@cloudflare/vite-plugin`, so a `dockerfile` project has no SSR shell.
   Recommend accepting that: 06 left "the SSR app as its own service" undecided, and a second SSR
   variant is a new feature. **Answered 2026-10-30: recommendation accepted.** Specs `627dc3e`: 080 step 3.
