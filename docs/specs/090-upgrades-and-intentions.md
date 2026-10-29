# 090 — Upgrades and migration intentions

## Objective

Keep consumer projects upgradeable after they diverge, without merging raw diffs from upstream.

**Model (adopt from [Lonestone Boilerstone](https://github.com/lonestone/lonestone-boilerplate/pull/122)):** each platform release ships **migration intentions** — the _meaning_ of a change (goal, applicability, stop conditions, validation). A human or supervised AI agent replays the smallest safe equivalent in the consumer tree. The CLI stages and records; it MUST NOT silently rewrite application code.

## Why not diffs

A project generated with `bg create` owns its code from day one. Upstream improvements (tooling, auth patterns, registry baselines) cannot land as a git merge. Intentions declare knowledge; the consumer executes locally.

## Lockstep prerequisite

Upgrades assume [070](./070-testing-and-release.md) lockstep: one semver for CLI + base template + registry + intentions for that release. The consumer’s `platform.version` is that semver.

## Tracking state (`bg.json`)

Extend the manifest ([020](./020-project-manifest.md)) with platform upgrade fields:

```json
{
  "version": 1,
  "platform": {
    "version": "0.2.0",
    "remote": "github:Netoun/bonne-garde-toolkit",
    "intentions": {
      "applied": ["v0.2.0/align-bun-pin"],
      "skipped": {
        "v0.2.0/adopt-optional-feature": "project does not use this capability"
      }
    }
  }
}
```

| Field                         | Rules                                                                                          |
| ----------------------------- | ---------------------------------------------------------------------------------------------- |
| `platform.version`            | MUST be semver **without** leading `v`; written by `create`; advanced only by `upgrade finish` |
| `platform.remote`             | MUST identify the platform git source used for fetches                                         |
| `platform.intentions.applied` | Canonical ids `vX.Y.Z/slug`                                                                    |
| `platform.intentions.skipped` | Map id → human reason                                                                          |

- Unknown future fields MUST be preserved with a warning (forward-compatible CLI).
- Manifest schema version remains the hard gate.
- Default when onboarding a pre-tracking project: `platform.version = "0.0.0"` (every intention stays applicable).

## Intention layout (producer repo)

```text
migrations/
  TEMPLATE.md
  v0.2.0/
    README.md
    00-setup-platform-tracking.md   # informational when needed
    01-align-bun-pin.md
    02-….md
```

Document format, frontmatter, required sections, `copy` / `adapt` reference paths, linting, and the executor protocol are defined once in [065](./065-intentions.md) and shared with module install intents. Migration-specific rules only:

| Rule                 | Detail                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Path                 | `migrations/vX.Y.Z/NN-slug.md`                                                                              |
| Id scope             | `vX.Y.Z` — `kind: migration`                                                                                |
| Domain               | Maps to a **category** the consumer tracks (`tooling`, `api`, `ui`, `auth`, `db`, …)                        |
| Release README       | MUST list every id in the release; `bg intentions lint` fails if stale, `bg intentions sync` regenerates it |
| No-migration release | Documented as prose in the release README                                                                   |

## Filtering

When computing an upgrade path, intentions MUST be filtered to:

1. versions `(current, target]` in lockstep order;
2. domains matching a category present in `modules`, or `items` for UI domains ([020](./020-project-manifest.md));
3. minus ids already in `applied` or `skipped`.

A domain the project never installed MUST instruct skip — never force-add an unrelated module.

## Publication & fetch

- Platform releases = git tags `vX.Y.Z` on `platform.remote` (same tags as lockstep publish).
- Consumer fetches into a **dedicated ref namespace** (e.g. `refs/bg/v*`), **not** the consumer’s `refs/tags`, so app tags never collide with platform tags.
- No publish API required beyond git + the npm CLI package for `create`/`bg`.

## CLI surface (`bg upgrade …`)

| Command                              | Behavior                                                                                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `upgrade status`                     | Current version, readiness (clean worktree, state valid, releases available); read-only                                                                                                                                          |
| `versions list`                      | Available platform tags from fetched refs                                                                                                                                                                                        |
| `upgrade path --to <ver\|latest>`    | Print intention plan; read-only                                                                                                                                                                                                  |
| `upgrade prepare --to <ver\|latest>` | Clean worktree required; build temp workspace; after validation create branch `upgrade/vA-to-vB` and atomically write `.bg/upgrade/` (numbered intentions, source/target projections, session checklist). MUST NOT edit app code |
| `upgrade record`                     | Record apply/skip in `bg.json` after validation                                                                                                                                                                                  |
| `upgrade finish --to <ver>`          | Fail closed until every intention in range is applied or skipped; then set `platform.version`                                                                                                                                    |

Everyday form: `bg upgrade` → target latest, refresh publications when needed, interactive selection on TTY.

Scratch `.bg/upgrade/` is gitignored and disposable. Deterministic work lives in the CLI; agent skills are thin shims over the runbook.

## Executor protocol

Defined once in [065](./065-intentions.md) — identical for upgrade and for module install intents. Upgrade adds one terminal step: the human runs `bg upgrade finish`, which advances `platform.version` only once every intention in range is applied or skipped.

## Maintainer release duties

On each lockstep release ([070](./070-testing-and-release.md)):

1. Classify every meaningful change.
2. Add `migrations/vX.Y.Z/NN-slug.md` for actionable adaptations (or document release-level `no-migration`).
3. `bg intentions lint` (+ sync) MUST pass in CI before tagging.
4. Changelog SHOULD link the release’s intention set.

## Phasing

| Phase                | Scope                                                                        |
| -------------------- | ---------------------------------------------------------------------------- |
| Now (specs)          | Lockstep + intention contract normative                                      |
| After create/add MVP | Tracking fields in `bg.json`; intention lint; empty `migrations/` + TEMPLATE |
| Next                 | `upgrade status/path/prepare/record/finish` + agent skill shims              |
| Later                | Full intention sets per release as the registry grows                        |

## Out of scope

- Automatic silent code rewrite
- Fork-and-merge upstream as the primary upgrade path
- Reverting tier-3 changes (tier 1 and 2 are revertible via `files` / `regions` — see [060](./060-patches-and-regions.md))
- Independent semver per item or module (lockstep owns the platform version)

## Acceptance

- Specs describe intentions as meaning-not-diffs, with Boilerstone-equivalent lifecycle.
- `create` writes `platform.version` matching the published lockstep version.
- Intention ids and layout are lintable.
- Upgrade CLI never mutates app code outside the documented executor loop.
