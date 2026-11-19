# 7. One lockstep version for the whole platform

Status: accepted

## Context

A per-module version with no lockstep leaves a project six months into divergence with nowhere to go. Independent CLI and registry versions drift.

## Decision

One semver versions the CLI, the base template, both catalogs and the migration intentions, as the git tag `vX.Y.Z` and the npm package `bonne-garde@X.Y.Z`. `create` writes that version into `bg.json` and pins the default registry to it, never to `main`. A module's own `version` is informational.

## Consequences

- Pushing a `v*` tag publishes the CLI to npm; the registry is read from the same tag over GitHub.
- A release lists its migration intentions in `migrations/vX.Y.Z/`, and the intentions lint runs before tagging.
- A tag cannot be rewritten without breaking `add` for the published CLI.
