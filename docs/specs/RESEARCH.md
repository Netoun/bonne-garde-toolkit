# Research — Platform references

Benchmark for Bonne Garde. Records what was adopted, what was rejected, and **which of our own decisions the comparison proved wrong**.

## Stanza — the module model

Sources: [jakejarvis/stanza](https://github.com/jakejarvis/stanza), `packages/schema/src/{module,manifest,category}.ts`.

**The finding that reframed everything: Stanza does not use AI intentions to install.** It installs deterministically with peer-matched adapters and region-aware `ts-morph` codemods. Intentions are Boilerstone's answer to _upgrade_, not to _install_. The two problems differ by one fact:

|                   | Project state                    | Viable mechanism |
| ----------------- | -------------------------------- | ---------------- |
| Install / compose | known (manifest + owned regions) | deterministic    |
| Upgrade           | arbitrarily diverged             | intentions       |

### What we took

| Idea                             | Their shape                                         | Ours                                                                       |
| -------------------------------- | --------------------------------------------------- | -------------------------------------------------------------------------- |
| Category with cardinality + home | 13 categories, topological order, `many` last       | [035](./035-module-registry.md)                                            |
| Peers with allow-list            | `peers: Partial<Record<CategoryId, ModuleId[]>>`    | `peers`                                                                    |
| Payload keyed by peer choice     | `adapters[].match`                                  | **`variants[].match`** — renamed to free `adapter` for its runtime meaning |
| Named codemod invocations        | `codemods: {id, args}[]`                            | typed `patch[]` catalog ([060](./060-patches-and-regions.md))              |
| Region ownership                 | `regions: file → dot-path → moduleId`               | `regions` in `bg.json`                                                     |
| Written-content checksum         | `readmeChecksum`                                    | `files[].sha256`, generalized to every copied file                         |
| Package-dedicated seam           | modules install into `packages/auth`, `packages/db` | normative in [035](./035-module-registry.md)                               |

### Our mistakes it exposed

1. **`conflicts: []` hand-maintained.** Stanza has no such field — a `cardinality: one` category _is_ the mutual exclusion. We modelled the constraint instead of the domain; our list would be wrong by the fifth module.
2. **`requires: ["db"]` as a flat capability.** Cannot express "auth needs an orm, and only drizzle". Blocks us at the second ORM.
3. **No variants.** One item = one file list forces either one item per combination (`auth-drizzle`, `auth-prisma`, …) or branching in the CLI. Both are wrong; the combinatorics belong in data.
4. **`transforms: ["workspace:apps/api"]` as free strings, never executed.** The six transforms of the old spec 060 were prose. They are now a closed, typed catalog.
5. **No ownership of what we wrote.** Without regions and checksums there is no revert, no provider swap, and no way to tell a user edit from an upstream change. "Perfect auto-uninstall out of scope" was a consequence of the gap, not a decision.
6. **`meta.bg` squatting in the shadcn schema.** Four fields carrying the core of the model inside someone else's format. Removed — see [030](./030-ui-registry.md).

### What we reject

- Per-module `version` with no lockstep and no upgrade path — a Stanza project six months into divergence has nowhere to go. That is the problem [090](./090-upgrades-and-intentions.md) exists to solve.
- Product surface we do not need in v1: `logo`, `label`, README merge into the consumer README, web builder.

## Boilerstone — the upgrade model

Sources: [lonestone-boilerplate](https://github.com/lonestone/lonestone-boilerplate), [PR #122](https://github.com/lonestone/lonestone-boilerplate/pull/122), [how-it-works](https://raw.githubusercontent.com/lonestone/lonestone-boilerplate/main/.boilerstone/docs/how-it-works.md).

Verified against the source; our [090](./090-upgrades-and-intentions.md) is faithful.

| Adopt                                                           | Reject / adapt                                                 |
| --------------------------------------------------------------- | -------------------------------------------------------------- |
| Intentions as meaning, not diffs                                | `install.sh` as primary entry                                  |
| `copy` vs `adapt` reference paths                               | —                                                              |
| `prepare` / `record` / `finish`, fail-closed                    | Fork-and-merge as the upgrade path                             |
| Executor **proposes**, human confirms; one commit per intention | Silent auto-apply of app code                                  |
| Gitignored disposable scratch dir; no state until `record`      | —                                                              |
| Per-release `NN-slug.md` + frontmatter domains                  | Separate `boilerplate.json` — folded into `bg.json` `platform` |
| Dedicated fetch refs (`refs/bg/v*`)                             | Consumer `refs/tags` collision                                 |
| Lockstep platform semver                                        | Independent drifting CLI vs registry versions                  |

**Extension:** the same format now also carries module install intents ([065](./065-intentions.md)). One parser, one linter, one executor protocol, one recording surface.

## Our own POC — `bonne-garde-registry`

A prior 5-minute proof of concept that turned out to be ahead of the boilerplate's `registry/` on the module model.

| Already right — kept                  | Detail                                                                                                                      |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Typed patch union with real tooling   | `jsonc-parser` `modify`, `ts-morph` — `env.append`, `jsonc.merge`, `ts.addImport`, `ts.addNamedExport`, `ts.elysiaUse`      |
| `template/` mirroring the target tree | The path _is_ the destination — no per-file `target` mapping                                                                |
| `PROMPT.md` per module                | The tier-3 idea, three months before it had a name                                                                          |
| `options`                             | Consumer toggles, distinct from peers                                                                                       |
| `checks`                              | Per-module validation commands                                                                                              |
| `manifestHash` + `doctor`             | Drift detection without network                                                                                             |
| **Patch `failed` → `guide`**          | Deterministic path degrading to an AI-guided one instead of aborting — now normative in [060](./060-patches-and-regions.md) |
| Package-dedicated layout              | `packages/{auth,db,email,queue,storage,ui}`                                                                                 |

| Gap — fixed here                                                    | Fix                                                               |
| ------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `PROMPT.md` is free text: no id, no frontmatter, no record          | [065](./065-intentions.md) — linted, recorded, `doctor`-checkable |
| A `failed` patch is reported but never resolved                     | Becomes a pending intent with a `record` lifecycle                |
| `integrations` keyed by app kind                                    | Generalized to `variants[].match` over peer modules               |
| `compatibility.workspaces` / `requiredPaths`                        | Replaced by `category` + `peers`                                  |
| Two state files (`bonne-garde.json` + `.bonne-garde/registry.json`) | One `bg.json` ([020](./020-project-manifest.md))                  |
| Separate repository                                                 | Folded in — lockstep needs one tag per platform state             |

## Scaffold UX — Better-T-Stack, create-\*

Sources: [create-better-t-stack](https://github.com/AmanVarshney01/create-better-t-stack), [create-t3-app](https://github.com/t3-oss/create-t3-app), [create-elysiajs](https://github.com/kravetsone/create-elysiajs).

| Adopt                                   | Reject                                    |
| --------------------------------------- | ----------------------------------------- |
| `bun create …@latest`                   | Arbitrary stack matrix                    |
| Template shipped inside the CLI package | GitHub-HEAD as the core path              |
| Base + feature installers               | Combinatorial full-project templates      |
| Stable non-interactive flags            | Experimental CI-only flags without semver |

## Generators — Nx / Turborepo

| Adopt                               | Reject                                    |
| ----------------------------------- | ----------------------------------------- |
| Virtual tree + `--dry-run`          | Direct FS writes without a plan           |
| Explicit collision strategies       | Silent overwrite as the only mode         |
| Separate create vs in-repo generate | Pretending a create-only CLI covers `add` |

## Locked decisions

1. Single repository; empty base; CLI + two catalogs.
2. Opinionated Bun + Cloudflare stack.
3. shadcn schema for UI items, untouched — native schema for modules.
4. Three tiers: `copy` / `patch` / `intent`. Tier 2 preferred over tier 3; a module with no tier 3 installs with no agent.
5. Compatibility by category cardinality and peers — never hand-written conflict lists or capability strings.
6. Modules own a dedicated workspace package; application code is patched only through the named catalog.
7. Lockstep version across CLI, template, both catalogs, and intentions.
8. One intention format for install and upgrade.
