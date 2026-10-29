# 06 — Platform gaps: CLI, architecture, components, impeccable

**Recommendation: the CLI is the only urgent one of the four.** It is the product, and it is
missing two commands its own specs declare MUST ship in v1. The architecture question is a
decision to record, not work to schedule. The component question comes due at one specific
moment, and impeccable comes due after that.

This file exists because [03](./03-backport-plan.md) is a backport plan — it answers "what do the
sibling repos have that we don't". None of the four subjects below is a backport, so none of them
appears there. That is a blind spot of the audit's framing, not an oversight of its execution.

## 1. The CLI — urgent

### What is missing

| Spec                                             | Says                                                                                                                                           | Reality                                                                                                                 |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [000](../../specs/000-product.md)                | "MUST ship `create`, `add`, `list`, `search`, `view`, `record`, `doctor` in v1"                                                                | `apps/cli/src/cli.ts` dispatches `create`, `list`, `search`, `view`, `add`, `intentions`. **No `record`, no `doctor`.** |
| [000](../../specs/000-product.md) success metric | "`bg doctor` reports drift between `bg.json` and the tree without network access"                                                              | Not implemented, so the metric cannot be met                                                                            |
| [050](../../specs/050-cli-add.md)                | Fully specifies both — usage line, a `## doctor` section, and acceptance criteria (`bg doctor --strict` green immediately after a clean `add`) | Specified, unimplemented                                                                                                |
| [070](../../specs/070-testing-and-release.md)    | Golden projects asserted **byte-for-byte** per supported peer combination; an E2E matrix create → add → install → typecheck → test → check     | `apps/cli` has 3 test files, 8 tests. Neither exists.                                                                   |

Total CLI surface: ~1030 lines across `apps/cli/src` and `packages/{registry,schema}`, of which
`intentions/lint.ts` is 236.

### Why `doctor` before anything else

`bg add` writes files and records them in `bg.json` with a sha256 per file and a region per patch
([060](../../specs/060-patches-and-regions.md)). Every guarantee that design buys — revert,
provider swap, telling a user edit from an upstream change, `remove` at all — depends on being
able to answer "does the tree still match the record". `doctor` _is_ that answer. Without it,
`add` is a one-way write and the checksums are decoration.

`record` is the smaller half: it closes the intention lifecycle that `intentions lint` already
validates and that [065](../../specs/065-intentions.md) requires.

### Recommendation

1. **`doctor` first**, offline: compare `bg.json`'s `files[].sha256` and `regions` against the
   tree, report drift in three buckets (missing, modified, unrecorded), `--json` and `--strict`.
   Spec 050 already defines the output; implement to it rather than inventing.
2. **`record` second** — it is mostly a manifest write, and `packages/schema` already owns the
   manifest.
3. **Then one golden project**, not the matrix. A single `create → add` fixture asserted
   byte-for-byte catches the class of regression the matrix is for, at a fraction of the cost. The
   matrix earns its keep once there are enough peer combinations to matter — today there is one.

Known defects to fold in while there: the `exactOptionalPropertyTypes` violations at
`apps/cli/src/cli.ts:60` and `:117` (forwarding `string | undefined` into `scope` / `registry` /
`source`), reported by the scripts-gate work and **not independently verified here**, and the
`no-console` warnings in `cli.ts` that `vp lint` reports today.

## 2. Architecture — one decision, and it is upstream of the code

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

## 3. Component decomposition — due at 080 step 2

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

## 4. impeccable — not yet

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

|     | What                                         | Cost                                                          |
| --- | -------------------------------------------- | ------------------------------------------------------------- |
| 1   | `bg doctor`, offline, to spec 050            | the largest single piece of CLI work left                     |
| 2   | `bg record`                                  | small; manifest write                                         |
| 3   | One golden project fixture                   | small; `scripts/gen-playground.ts` is most of the scaffolding |
| 4   | Front layout as a normative line in spec 035 | one paragraph                                                 |
| 5   | `docs/RULES.md` §5 Front — Composition First | one section, adapted from three repos                         |
| 6   | `packages/ui` structure                      | rides 080 step 2                                              |
| 7   | impeccable                                   | after the first real screens                                  |

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
