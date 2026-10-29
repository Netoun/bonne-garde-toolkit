# 06 — Platform gaps: providers, CLI, architecture, components, impeccable

**Recommendation: white-label providers first, then the CLI.** The provider category decides
what every later choice costs, and it changes what `bg.json` v2 has to record, so it comes before
the schema revision. The CLI is the product and is still missing two commands its own specs
declare MUST ship in v1. The architecture question is a decision to record, not work to schedule.
The component question comes due at one specific moment, and impeccable comes due after that.

This file exists because [03](./03-backport-plan.md) is a backport plan — it answers "what do the
sibling repos have that we don't". None of the five subjects below is a backport, so none of them
appears there. That is a blind spot of the audit's framing, not an oversight of its execution.

## 1. Providers en marque blanche — `cloudflare` and `dockerfile`

**This is a new category, not a new mechanism.** Spec 035 already says the quiet part out loud:
"the combinatorial explosion is data, not branching code", and `variants[].match` is
`Partial<Record<Category, ModuleId>>`. A provider is simply the peer that variants match on. No
new field, no branching, no plugin system — the thing spec 035's "Not doing" list already refuses.

### The shape

|                                                   |                                                                                    |
| ------------------------------------------------- | ---------------------------------------------------------------------------------- |
| New category                                      | `provider` — cardinality **one**, home **repo**                                    |
| Position                                          | **First** in the topological order: everything may peer on it, it peers on nothing |
| Modules                                           | `cloudflare`, `dockerfile`                                                         |
| Categories that gain `peers: { provider: [...] }` | `api`, `db`, `storage`, `deploy`                                                   |

Each of those four then ships one variant per provider — `match: { provider: "cloudflare" }` and
`match: { provider: "dockerfile" }` — and `cardinality: one` on `provider` makes a second one a
conflict by construction, exactly as the category table intends.

### What spec 035 has to stop saying first

Three Notes in the category table name Cloudflare, which contradicts the feature at the level of
the spec:

| Category | Note today            | Why it is wrong                    |
| -------- | --------------------- | ---------------------------------- |
| `api`    | "Elysia Worker shell" | A Worker is one provider's runtime |
| `db`     | "D1 binding + client" | D1 is one provider's database      |
| `deploy` | "wrangler / CI"       | wrangler is one provider's tool    |

These are the provider's business, not the category's. They have to become provider-neutral
("Elysia app shell", "binding + client, provider-matched", "CI / deploy pipeline") or the spec
argues against itself.

### The real coupling, measured

Every row below is a seam that has to resolve per provider. Line numbers are from `96aa898`.

| Seam            | Where                                                                                 | `cloudflare` | `dockerfile`                       |
| --------------- | ------------------------------------------------------------------------------------- | ------------ | ---------------------------------- |
| Runtime adapter | `apps/api/src/app.ts:3,12` — `CloudflareAdapter`, `aot: false`                        | as is        | default Bun adapter, `aot` left on |
| **Env access**  | `apps/api/src/lib/app.config.ts:11` — `await import("cloudflare:workers")`            | as is        | `process.env`                      |
| DB driver       | `apps/api/src/modules/db/db.client.ts:1,2,10` — `drizzle-orm/d1`, `DrizzleD1Database` | as is        | `drizzle-orm/libsql`               |
| Binding types   | `apps/api/src/lib/env.ts:2,3` — `D1Database`, `R2Bucket`                              | as is        | driver handle + storage client     |
| Storage         | `apps/api/src/lib/r2.ts:116,144` — `R2Bucket` parameters                              | as is        | S3-compatible, or local filesystem |
| Ambient types   | `apps/{api,spa,ssr,static}/tsconfig.json` — `types: ["@cloudflare/workers-types", …]` | as is        | dropped                            |
| Front build     | `apps/ssr/vite.config.ts:1` — `@cloudflare/vite-plugin`                               | as is        | plain React Router build           |
| SSR context     | `apps/ssr/workers/app.ts`, `apps/ssr/src/lib/cloudflare-context.ts`                   | as is        | request-scoped context             |
| Deploy config   | four `wrangler.jsonc`, plus two under `registry/apps/`                                | as is        | `Dockerfile` + `compose.yaml`      |
| Dev secrets     | `apps/api/.dev.vars.example`                                                          | as is        | `.env.example`                     |

### The one seam that is not a variant

`await import("cloudflare:workers")` at `apps/api/src/lib/app.config.ts:11` is a
**runtime-provided module specifier**. A `dockerfile` build that still carries that line fails at
bundle time, not at run time, and no `variants[].match` can save it because the import is in
application code rather than in a module's own package.

So this one has to be refactored **before** either provider module exists: `app.config.ts` loses
the import and takes its environment from an injected source. Spec 035's package-dedicated seam
rule points at where it goes — "a module with a `package` home MUST write only inside its own
package" — so the env seam belongs to a package, not to `apps/api/src/lib`.

It is the only hard blocker in the list. Everything else above is a value that differs per
provider; this is a build that breaks.

### Why providers come before `bg.json` v2

Because v2 is the revision that records variant selection. Spec 020 already specifies that v2
splits `installed` into `items` and `modules`; a module's record has to carry the `variant` key
([035](../../specs/035-module-registry.md): "`key` — stable identifier for the combination;
recorded in `bg.json`"), and variant keys are provider-derived the moment `provider` is a peer.
Settling the provider category first means the v2 shape gets designed once with the provider in
it, instead of designed now and revised later.

### Not doing

- **A third provider** (Fly, Vercel, bare Node) before two of them work. Two providers prove the
  seam; the third proves nothing new and triples the variant count on four categories.
- **Postgres in `dockerfile`.** Tempting, but it moves Drizzle's dialect off sqlite, which is a
  wider blast radius than the provider work itself — `db.config.ts`, every migration in
  `apps/api/migrations`, and the real-SQLite test helpers. Ship `dockerfile` on libsql/SQLite
  first so the dialect holds; Postgres is a separate `db` module afterwards.

### Unresolved

1. **Is `web` provider-matched too?** Pages, versus a static layer in the container, versus the
   SSR app as its own service. Probably yes, which makes five categories rather than four.
2. **Does `deploy` stay `cardinality: many`?** It is `many` today so a repo can hold several
   pipelines. With a provider peer, "one deploy module per provider" may be the better rule — and
   that is a change to the category table, not to a module.
3. **Does the legacy tree get the refactor, or only the modules?** `app.config.ts` has to change
   for `dockerfile` to build at all. Spec 080 deletes `apps/api` once its module is green, so this
   is the one place where touching legacy code is not thrown away — it is the seam the `api`
   module will vendor.

## 2. The CLI — urgent

### What is missing

| Spec                                             | Says                                                                                                                                           | Reality                                                                                                                     |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| [000](../../specs/000-product.md)                | "MUST ship `create`, `add`, `list`, `search`, `view`, `record`, `doctor` in v1"                                                                | `packages/cli/src/cli.ts` dispatches `create`, `list`, `search`, `view`, `add`, `intentions`. **No `record`, no `doctor`.** |
| [000](../../specs/000-product.md) success metric | "`bg doctor` reports drift between `bg.json` and the tree without network access"                                                              | Not implemented, so the metric cannot be met                                                                                |
| [050](../../specs/050-cli-add.md)                | Fully specifies both — usage line, a `## doctor` section, and acceptance criteria (`bg doctor --strict` green immediately after a clean `add`) | Specified, unimplemented                                                                                                    |
| [070](../../specs/070-testing-and-release.md)    | Golden projects asserted **byte-for-byte** per supported peer combination; an E2E matrix create → add → install → typecheck → test → check     | `packages/cli` has 3 test files, 8 tests. Neither exists.                                                                   |

Total CLI surface: ~1030 lines across `packages/cli/src` and `packages/{registry,schema}`, of which
`intentions/lint.ts` is 236.

### Why `doctor` before anything else

Spec 020 v2 gives `bg.json` a `files` map (owner + sha256 per written file) and a `regions` map
(owner per patched region), and spec 060 builds revert, provider swap, telling a user edit from an
upstream change, and `remove` on top of them. `doctor` is the command that reads them back.

**Corrected 2026-10-29:** an earlier draft of this file said `add` writes those records and only
`doctor` was missing. It does not. `git grep -n "sha256\|regions\|createHash" -- packages`
returns nothing: `apply-plan.ts` writes `installed[name] = { source, version, installedAt }` and
that is all. So the gap is two commands wide, not one — `add` has to start recording before
`doctor` has anything to check, and that recording only has a place to go once the manifest is
v2.

`record` is the smaller half: it closes the intention lifecycle that `intentions lint` already
validates and that [065](../../specs/065-intentions.md) requires.

### Recommendation (ordering within the CLI work)

1. **`doctor` first**, offline: compare `bg.json`'s `files[].sha256` and `regions` against the
   tree, report drift in three buckets (missing, modified, unrecorded), `--json` and `--strict`.
   Spec 050 already defines the output; implement to it rather than inventing.
2. **`record` second** — it is mostly a manifest write, and `packages/schema` already owns the
   manifest.
3. **Then one golden project**, not the matrix. A single `create → add` fixture asserted
   byte-for-byte catches the class of regression the matrix is for, at a fraction of the cost. The
   matrix earns its keep once there are enough peer combinations to matter — today there is one.

Known defects to fold in while there: the `exactOptionalPropertyTypes` violations at
`packages/cli/src/cli.ts:60` and `:117` (forwarding `string | undefined` into `scope` / `registry` /
`source`), reported by the scripts-gate work and **not independently verified here**, and the
`no-console` warnings in `cli.ts` that `vp lint` reports today.

## 3. Architecture — one decision, and it is upstream of the code

The audit examined the _skeleton_ (`lib/`, auth, db, test seams) and never asked whether our
module boundaries are right. On the API side they are: `modules/<feature>/` with contract,
service, routes, module is consistent across all four repos and the conventions skill documents it.

The open question is the **front layout**, and the two sibling repos chose differently:

|                       | batch                                                                                       | treashunt                                                                                                             |
| --------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Layout                | `src/features/<domain>/` plus root `components/`, `hooks/`, `lib/`, `providers/`, `stores/` | `src/app/` (providers, API clients, app-only state), `src/shared/`, `src/features/<domain>/` with nested sub-features |
| Cross-feature imports | features import each other directly                                                         | **only** through that feature's `public.ts`; no `index.ts` barrels                                                    |
| Root folders          | yes                                                                                         | no root `components/`, `hooks/`, `lib/` or `stores/`                                                                  |

treashunt's is the stricter one and the one that scales: a `public.ts` per feature makes the
import graph a declared surface instead of an emergent one, and banning barrels is what keeps it
honest. batch's is cheaper to start and degrades into a ball of mutual imports, which is what root
`components/` and root `hooks/` already signal.

**This decision must land before the `web` module exists**, because whatever shape it has is what
gets vendored into every generated project, and tier-1 `copy` files are the consumer's from day
one. It does **not** belong to `apps/spa|ssr|static`: [080](../../specs/080-existing-code-migration.md)
deletes those once the modules replacing them are green, so restructuring them now is work thrown
away.

**Recommendation:** adopt treashunt's layout, and write it into
[035](../../specs/035-module-registry.md) as a normative requirement of the `web` category — one
paragraph, now, while it costs a paragraph. Not a refactor of the legacy apps.

## 4. Component decomposition — due at 080 step 2

`packages/ui` is the one front surface that survives the migration: it is the home package of the
`ui` category. Two concrete gaps.

**It is flat, and already past the point where flat stops working.**
`packages/ui/src/components/` holds **29 files** in one directory. treashunt splits the same
surface into `primitives/` (shadcn output), `layouts/` and `patterns/`. keeper's slop-sweep is the
empirical argument: it grouped 42 flat component files by what they render (SF045), another 23
(SF044), and split a 1617-line component into three units (SF052). The flat layout did not survive
either repo past roughly twenty files.

**`docs/RULES.md` has no front section at all.** Its seven sections are Clean Code, TDD, Types,
Product Conventions, Scope, Tools, Checklist. batch, treashunt and keeper all carry a
"Front — Composition First" section: slots over config props, children first, compound components,
no boolean explosion, open wrappers, data mapped by the page. Without it, every composition
judgement on this repo is made from memory, and an agent reading `RULES.md` finds nothing.

While there: §3's heading still reads "Nested Routes Pattern (games under scenarios, nodes under
scenarios…)" — treashunt domain examples in our own rules file
([01](./01-consumers.md) §D.6 has the full list).

**Recommendation:** write RULES §5 now (it is prose, it unblocks every later judgement, and the
text exists in three repos to adapt from). Restructure `packages/ui` at 080 step 2, when the `ui`
module is extracted and the directories have to be decided anyway — not as a standalone move that
rewrites 29 import paths for no behavioural gain.

## 5. impeccable — not yet

The `impeccable` plugin is enabled, and all three sibling repos carry a `.impeccable/`; this repo
does not. It is a visual-quality and design-system skill.

The registry currently ships `badge`, `button`, `card` and `utils`. There is nothing to critique.
It earns its place once the UI catalog has real screens — realistically after the `web` module and
the first `features/*` registry items exist. Adding `.impeccable/` config before then is
configuration without a subject.

Note for when it does land: keeper had to add `.claude/skills/` and `.agents/skills/` to its lint
and knip ignore lists, because `vp check` otherwise lints the skills themselves
([01](./01-consumers.md) §D.7).

## Order and cost

|     | What                                                          | Cost                                                          |
| --- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | `provider` category in spec 035, and the three leaking Notes  | one table row and three cells                                 |
| 2   | Lift the env seam out of `apps/api/src/lib/app.config.ts`     | small, but application code — and the only hard blocker       |
| 3   | `cloudflare` and `dockerfile` provider modules                | the bulk of it; four categories × two variants                |
| 4   | `bg.json` v2, to spec 020                                     | schema, plus the migration path 020 already describes         |
| 5   | `add` records `files`, `regions` and `modules` (the v2 shape) | the prerequisite nobody had noticed; see §2                   |
| 6   | `bg doctor`, offline, to spec 050                             | the largest single piece of CLI work left                     |
| 7   | `bg record`                                                   | small; manifest write                                         |
| 8   | One golden project fixture                                    | small; `scripts/gen-playground.ts` is most of the scaffolding |
| 9   | Front layout as a normative line in spec 035                  | one paragraph                                                 |
| 10  | `docs/RULES.md` §5 Front — Composition First                  | one section, adapted from three repos                         |
| 11  | `packages/ui` structure                                       | rides 080 step 2                                              |
| 12  | impeccable                                                    | after the first real screens                                  |

## Not doing

- **Restructuring `apps/spa|ssr|static`.** Spec 080 deletes them. Any decomposition work there is
  thrown away on a schedule this repo has already chosen.
- **The full E2E peer matrix from spec 070.** One golden project first; the matrix when there is
  more than one peer combination to cover.
- **A generic plugin or hook system for the CLI.** Spec 060's typed patch catalog plus spec 065's
  intentions already cover what modules need to do to a project. A third extension mechanism would
  be the fourth way to say the same thing.

## Unresolved questions

1. **`doctor` strictness on unrecorded files.** A file in a module's directory that `bg.json` does
   not record: drift, or the consumer's own code? Spec 050 says `--strict` is green right after a
   clean `add`, which implies unrecorded files are drift — but that makes `doctor` noisy the moment
   anyone adds a file next to a vendored one. Needs a decision before implementing.
2. **Front layout: treashunt's `public.ts` discipline, or batch's directness?** The recommendation
   above is treashunt's, but it is stricter than anything this repo enforces today.
3. **Does `packages/ui` keep shadcn output separate?** treashunt's `primitives/` exists so the
   shadcn CLI owns one directory and humans own the others. That only works if `components.json`
   points there, which is a one-time, breaking move for existing import paths.
