# 8. One intention format for install and upgrade

Status: accepted

## Context

The registry proof of concept had a free-text `PROMPT.md` per module: no id, no frontmatter, no record. A project drifts silently from what such a prompt assumed. Boilerstone proved the intention model for upgrades.

## Decision

A module's tier-3 change and a release's migration share one document format, one parser, one linter, one executor protocol and one recording surface in `bg.json`. They differ only by the id scope (`<category>/<module>/<slug>` or `vX.Y.Z/<slug>`) and `kind`. An intention declares meaning (goal, applicability, observable gaps, validation), never a diff. The CLI stages and records; it never rewrites application code.

## Consequences

- An intention is auditable state: linted, recorded, and checked by `doctor`.
- Nothing is recorded before its validation passes, and a dirty worktree refuses staging.
- Upgrades are meant to follow the same loop; see [RELEASE.md](../RELEASE.md).
