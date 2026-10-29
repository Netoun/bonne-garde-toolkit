# 05 — Lonestone / Boilerstone harvest

**Recommendation: take five things, reject the rest, and fix one inconsistency this harvest
exposed in our own specs.** `docs/specs/RESEARCH.md` already benchmarked Boilerstone against
[PR #122](https://github.com/lonestone/lonestone-boilerplate/pull/122) and concluded _"our 090 is
faithful"_. That still holds. The value here is the **field lessons** — what Lonestone designed,
then changed after shipping it.

The notes in `lonestone-boilerplate/tasks/` are git-excluded working notes, and they have drifted
from what shipped: they say `.boilerplate/`, the code says `.boilerstone/`, with the CLI published
as `@lonestone/boilerstone-cli`. Status below is taken from the code, not the notes.

## Take

### 1. Author the intention in the feature PR, not at release time — **adopt**

Their biggest change of mind. Designed (`03-release-draft-generation`): an AI command
`release draft --from --to --next` diffs two refs and drafts the intentions. **Never built.**
Replaced by: the author writes `migration-intentions/unreleased/<slug>.md` in the same PR as the
change, because the author has the _why_ and the maintainer is "a plumber". Enforced by CI:

| Check                           | Rule                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Intention gate**              | The PR must add `unreleased/*.md`, or carry the label `no-intention`, or be the release PR                           |
| **Intention promote**           | On the release PR, `unreleased/` must be empty and each file must exist at `vX.Y.Z/NN-slug.md` with a rewritten `id` |
| `intentions promote --to X.Y.Z` | Moves `unreleased/` → `vX.Y.Z/NN-slug.md` in filename order, rewrites `id` and `requires`, then runs `sync`          |

Our spec 090 "Maintainer release duties" puts intention authoring **at release time** — the thing
they abandoned. **Cost:** a `migrations/unreleased/` directory, a `bg intentions promote` command,
and two CI jobs. We already have `bg intentions lint`; `promote` is the missing half.

### 2. Network access policies on the upgrade path — **adopt as-is**

`resolveUpgradePath` takes one of three policies: `local-only` (used by `finish`, fails closed),
`refresh-if-needed` (default), `refresh-required` (`--fetch`). It refuses downgrades. The pure
core (`computeUpgradePath`) does the filtering; the wrapper owns all I/O. That split matches spec
070's TDD rule, and the three policies are the part we do not have.

### 3. Producer draft mode — **adopt with adaptation**

While a release is untagged, the producer's own committed `HEAD` serves intentions and reference
files, refused if the producer tree is dirty; a consumer never falls back to its own HEAD. Without
this, an intention cannot be tested before it is tagged — and lockstep means tagging is expensive.

### 4. Dependency bump policy — **adopt**

No open-ended "update dependencies" intention. Three channels only:

1. **Plumbing** — engines, `packageManager`, catalogs. Zero package bumps.
2. **Coherent-set alignment** — one catalog family at a time: validate, commit, and if breakage
   goes past mechanical fixes, pin with a `# pinned: <reason>` comment.
3. **A framework migration intention owns its own bumps.**

This is exactly the shape [04](./04-deps-plan.md) arrived at independently (PR 1 / PR 2 / PR 3).
Worth writing into spec 090 as policy rather than rediscovering it per release.

### 5. Three small manifest rules — **adopt**

From `boilerplate.schema.json` (JSON Schema 2020-12, `additionalProperties: true` throughout,
`schemaVersion` the only hard gate) and its runtime checks in `tracking-state.ts`:

| Rule                                                                                           | Why                                       |
| ---------------------------------------------------------------------------------------------- | ----------------------------------------- |
| An id MUST NOT be both applied and skipped                                                     | A contradiction our 090 does not forbid   |
| A skip `reason` has `minLength: 10`                                                            | Stops `skipped: {id: "n/a"}`              |
| `applied[]` carries `{ id, appliedAt }` (date `YYYY-MM-DD`, validated as a real calendar date) | Answers "when did this project last sync" |

**Cost of `appliedAt` is not one field.** `platform.intentions.applied` goes from `string[]` to
objects, which is a manifest-schema change: `packages/schema/project.schema.json`, its tests, and
the `version` gate that spec 020 calls the hard failure. Also take their write discipline —
temp file then rename, unknown properties preserved with a warning — which 020 already states.

## Reverse an earlier reading: no legacy checkpoints

`grep -rn -i checkpoint docs/specs/` returns **nothing**, so our 090 has no checkpoint concept.
That looked like a gap against their `04-legacy-checkpoints` note. It is not: **they never built
it either** — zero occurrences in `.boilerstone`. What shipped instead is exactly what 090
already does: `0.0.0` as the default source version for an untracked project, plus a release
(their v1.0.0) whose intentions are broad "baseline catch-up" items, each budgeted at roughly one
working session.

**So: do not add checkpoints.** Add the one safety note they learned instead — intentions tagged
with the source version itself are never replayed, so a user who answers the version prompt _too
high_ silently skips work. Their `boilerstone-init` skill warns about it; our onboarding text
should too.

## Reject

| Idea                                                                                                                | Why                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fingerprint-based source detection (`08`)                                                                           | Designed, never built. They ship state file → `git describe --tags` (medium confidence) → prompt defaulting to `0.0.0`. A confidently wrong guess is worse than replaying.                                                                                                                                                                                                                                                                                               |
| `06-template-cleanup` machinery                                                                                     | Producer-only markers, a removal list, workflows that self-skip. We are structurally immune: `templates/base` is empty by construction. Relevant only if workflow files ever ship from the template.                                                                                                                                                                                                                                                                     |
| Per-tag docs versioning                                                                                             | Designed in `tasks/docs-versioning.md`, **not built** — `deploy-docs.yml` still builds `main` only. We have no docs site. Keep the underlying rule: anything describing the CLI is versioned with the CLI, and a docs app must not ship inside `templates/base` — their stated reason for rejecting `starlight-versions` is the mistake we would otherwise make. (Note they ship `apps/documentation` in every generated project anyway, which is how they got into it.) |
| `AGENTS.md` and `CLAUDE.md` duplicated byte-for-byte                                                                | We already import. Do not copy the duplication.                                                                                                                                                                                                                                                                                                                                                                                                                          |
| pnpm specifics, NestJS/MikroORM content, Docker/Dokploy/GHCR promote workflows, Node 24.13 pins, the Expo leftovers | Not our stack.                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

## Release automation: pick one, not both

Spec 070 names Tegami as _preferred, optional_. Lonestone's release-please setup is the proven
alternative, and it is more than a config file:

| Piece                                   | Mechanism                                                                                                                                                                                                                                                         |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `release-please-config.json`            | `release-type: node`, `include-v-in-tag`, `always-update: true`. **`extra-files` bumps `.boilerstone/cli/package.json` at `$.version`** — so the CLI version always equals the release version. That is our lockstep requirement, implemented in one config line. |
| `commitlint.config.ts`                  | Scope **required**, from a fixed `SCOPES` list = their tracked domains. Single source of truth: docs, skills and intentions point at it and never copy the list. For us, scopes = spec 035 categories.                                                            |
| `scripts/lint-pr.ts`                    | Lints the PR title as a commit header. Blocks the `BREAKING-CHANGE:` token (it forces a major from anywhere in a body), images, task lists, WIP words. Every error message states the fix.                                                                        |
| Squash-only, PR title/body = the commit | A repo-settings script sets it; `finalize-pr` does the WIP→squash rewrite locally; CI only checks. "The PR description is a pencil; the squash commit is the paper."                                                                                              |
| Publish job hardening                   | Version must equal the tag · `install --ignore-scripts` **before** an OIDC token exists · build · verify `dist` · provenance · `workflow_dispatch(tag)` to retry the publish alone.                                                                               |
| CI cost                                 | Draft PRs skipped by an `if` on the first job that everything else `needs`; concurrency cancels superseded PR runs only.                                                                                                                                          |

**Recommendation: take release-please, not Tegami**, and amend spec 070. The deciding argument is
`extra-files`: lockstep between the git tag and the published CLI version becomes declarative
instead of a script we maintain. Take `commitlint` with it — automated bumps driven by unenforced
commit messages is a silent failure, and none of our four repos has a `commit-msg` hook today.
Do **not** claim `bun publish` supports npm OIDC trusted publishing; that is unverified. Use
`npm publish` in CI if provenance is wanted.

Take their `pre-push` idea (lint + typecheck piped) but keep husky — switching to lefthook buys
nothing when `.husky/pre-commit` → `bunx vp staged` already works.

## The one architectural difference worth naming

Boilerstone is a **template you fork**, with an upgrade path added afterwards. We are a **CLI that
composes**. That is why their upgrade protocol transfers almost entirely and their _distribution_
design does not: `06-template-cleanup` exists only because a forked project inherits maintainer
tooling it must then delete, and `temp/pr-159-resume.md` records what that costs — `rock` deleted
the CLI directory then read its own version from it (every new project crashed), and `onboard`
reused the template cleanup list and deleted client folders.

Their resulting rule is worth adopting verbatim, because it is general:

> A tool never deletes outside its own directory. Cleaning up an existing project is done by an
> intention, not by the CLI.

Apply it to spec 080 and to `bg remove`.

Also worth knowing: they have an **unmerged** registry proposal
(branch `docs/registry-architecture`, Oct 14, docs only, nothing built) that reaches for the same
shape as our 030/035/060 — items with `item.json`, `requires`, `INSTALL.md`, `files/`, no version
of their own, recorded in the manifest. Our specs are further along (variants, typed patch
catalog, regions, sha256 ownership). Two of their ideas do not exist in ours:

- **`item:` / `module:` frontmatter on an upgrade intention, checked _before_ the domain filter.**
  Our 090 filters by domain mapped to a category. For a `cardinality: many` category, an
  improvement to one module would otherwise reach every project holding _any_ module in that
  category. Real gap — adopt.
- **"Items add, they do not edit; the base offers a registration hook first."** This is in direct
  tension with our region/patch catalog, which lets a module edit project-owned files under
  ownership. Worth a design discussion, not a copy: their rule is simpler and loses expressiveness,
  ours is more powerful and carries the checksum/region machinery to prove it.

Their eight item rules are the kind of thing we have not written down. Two are worth stealing
outright: **"an item must be earned — built for real clients at least twice, with an owner"** and
**"a vendor is a setting, not a layer"** (which is precisely our `adapter` ≠ `variant` distinction
in spec 000).

## Found while comparing: an inconsistency in our own specs

| Place                                    | Says                        |
| ---------------------------------------- | --------------------------- |
| `docs/specs/020-project-manifest.md:56`  | `version` MUST be `2`       |
| `packages/schema/project.schema.json:10` | `"version": { "const": 1 }` |
| `templates/base/bg.json:2`               | `"version": 1`              |
| `docs/specs/090-…md:23` (example)        | `"version": 1`              |

Spec 020 is normative, documents the v1 → v2 migration (`installed` splits into `items` and
`modules`, `capabilities` dropped) and calls the `version` gate the hard failure. The schema
package and the base template still emit `1`, and `templates/base/bg.json` still carries
`installed: {}` and `capabilities: []` — the **v1** shape. So either the code has not caught up
with 020, or 020 moved ahead of a decision that was never implemented. Resolve it before anything
writes a manifest in anger: a `create` that emits a manifest its own schema rejects at v2 is a
release-blocking bug.

Not from Lonestone — but this harvest is what surfaced it.
