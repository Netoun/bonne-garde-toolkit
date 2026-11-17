# 070 — Testing and release

## Objective

Define verification and release rules for the platform.

## Testing

| Layer           | Rules                                                                                                               |
| --------------- | ------------------------------------------------------------------------------------------------------------------- |
| Unit / contract | Bun test; validate the manifest schema, the shadcn `registry.json`, and every `module.json`                         |
| Patches         | Each catalog entry ([060](./060-patches-and-regions.md)) tested for apply → skip idempotency on a real fixture file |
| CLI             | Real temp filesystem; no mocked `fetch` unless testing remote source adapters                                       |
| E2E matrix      | create → add combinations → install → typecheck → test → check                                                      |
| Golden projects | Generated fixtures per supported peer combination, asserted byte-for-byte                                           |

### Test surfaces (normative)

Every test file MUST be reachable from `bun run test`. Two failure modes are forbidden by construction:

- Tests under `scripts/` MUST be run. They are outside the `packages/*` workspace glob, so the root `test` script MUST target them explicitly — a release-tooling test that never runs is worse than none.
- A bare `bun test` at the root MUST NOT sweep `registry/` or `templates/`: those trees are **source material**, not workspaces, and their imports resolve only after install into a consumer project. They are verified through golden projects.

### Verification scripts

The platform scripts cover what runs in this repository: `packages/{cli,registry,schema}`, `scripts/`, and the registry module tests that need no install (`test:scripts` skips the module trees whose imports resolve only in a project). The rest of `registry/` and `templates/` is source material, verified through golden projects.

| Script                                                    | Scope                                        |
| --------------------------------------------------------- | -------------------------------------------- |
| `typecheck:platform` / `test:platform` / `check:platform` | `packages/{cli,registry,schema}`, `scripts/` |
| `typecheck` / `test`                                      | The platform scripts above                   |
| `check`                                                   | The whole repository (format and lint)       |

CI MUST run `verify` (the gate for the code above), then `golden` (the generated projects).

## TDD

- CLI, schema, and patch catalog MUST be developed red → green.
- Prefer behavior at public seams (`create`, `add`, `applyPatch`, `parseProjectManifest`, `loadRegistry`, `lintIntentions`).

## Lockstep versioning (normative)

One semver versions **the whole platform** together:

| Surface              | How it carries the version                                                           |
| -------------------- | ------------------------------------------------------------------------------------ |
| Git                  | Annotated tag `vX.Y.Z`                                                               |
| npm                  | `bonne-garde@X.Y.Z` (and matching workspace package versions)                        |
| Base template        | Embedded in that tarball ([010](./010-base-template.md))                             |
| UI registry          | Resolved from the same tag ([030](./030-ui-registry.md))                             |
| Module registry      | Resolved from the same tag ([035](./035-module-registry.md))                         |
| Migration intentions | `migrations/vX.Y.Z/` published on that tag ([090](./090-upgrades-and-intentions.md)) |

**Rules:**

- All five surfaces MUST live in one repository ([000](./000-product.md)). Two repositories would mean two tags for one platform state.
- MUST NOT publish CLI / tag git / ship catalog changes as independent drifting versions.
- A module's own `version` field is informational; the lockstep semver recorded in `bg.json` is authoritative.
- `bonne-garde create` MUST write `platform.version` (and default registry pin) to the **same** `X.Y.Z` as the running CLI package — never a mutable branch (`main`).
- Release/fixture tests MUST NOT silently install from `main`.
- Changelog MUST list version bumps and SHOULD list new/changed items, modules, and intention ids for that release.

### Release tooling

Preferred automation: a Node/Bun release script (e.g. [Tegami](https://tegami.fuma-nama.dev/)) that bumps the single lockstep version, updates changelogs, and drives publish — optionally as one [package group](https://tegami.fuma-nama.dev/docs/guide/package-groups). Tegami is optional; a custom script is fine if it preserves lockstep.

Pipeline shape:

1. **Changelogs / conventional commits** → intended bump
2. **Version** → write `X.Y.Z` everywhere required + validate intentions lint
3. **Publish** → git tag `vX.Y.Z` → `.github/workflows/release.yml` packs and publishes to npm (+ GitHub release)

## Publish (CLI package)

- CLI published to npm as **`bonne-garde`** by `.github/workflows/release.yml` when a tag `vX.Y.Z` is pushed: `pack:cli`, then `npm publish` with npm trusted publishing (`bun publish` does not do its OIDC exchange). No npm token is stored; npm adds provenance. The workflow refuses a tag that does not name the packed version, and the packed `repository.url` MUST name this repository exactly. A tag pushed before the workflow existed is published by running it by hand with that tag.
- `bunx bonne-garde create my-app` resolves that package, as do `npx`, `pnpm dlx` and `yarn dlx`; its one bin is `bonne-garde`.
- The published tarball MUST be JavaScript that runs on Node ≥ 22.12 and on Bun (Node never strips types inside `node_modules`): one bundled bin file, with `templates/base` embedded, schema and registry vendored into the bundle (no `workspace:` deps), and the npm dependencies the bundle imports declared, pinned to an exact version. Golden runs the packed bin with `node`, and CI has a Node of that floor.
- Registry items pinable by git tag/commit for remote installs (`github:Netoun/bonne-garde-toolkit`).
- Dry-run: `bun run publish:cli:dry`.

## Acceptance

- `bun run test:platform` passes and includes every test under `scripts/`.
- Contract suite fails if any `registry.json` is invalid against the shadcn schema, or any `module.json` has an unknown category or an ambiguous `match` set.
- Every patch type has an idempotency test.
- Smoke: create + add of the MVP set succeeds in a temp directory with `--yes --no-install` and no TTY.
- A tagged release `vX.Y.Z` implies npm `bonne-garde@X.Y.Z` and matching template / catalogs / intentions for that tag.
