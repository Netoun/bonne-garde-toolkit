# Release and upgrades

## Lockstep

One semver versions the whole platform ([ADR 7](./adr/0007-lockstep-versioning.md)): the git tag `vX.Y.Z`, `bonne-garde@X.Y.Z` on npm, the embedded base template, both catalogs (read from the same tag) and `migrations/vX.Y.Z/`.

- `create` writes `platform.version` and the default registry pin as the running CLI's version, never `main`. Tests never install from `main`.
- The changelog lists the version, and the new or changed items, modules and intention ids.

## Publish

Pushing a tag `vX.Y.Z` runs `.github/workflows/release.yml`: `pack:cli`, then `npm publish` with npm trusted publishing (no token stored, provenance added). It refuses a tag that does not name the packed version, and the packed `repository.url` must name this repository. A tag pushed before the workflow existed is published by running the workflow by hand with that tag. Dry run: `bun run publish:cli:dry`.

The docs site on GitHub Pages holds two versions, both built by `.github/workflows/docs.yml`:

| Version | URL                                                  | Built from                                                           |
| ------- | ---------------------------------------------------- | -------------------------------------------------------------------- |
| Release | `https://netoun.github.io/bonne-garde-toolkit/`      | The latest `v*` tag: what the published `bonne-garde` can install    |
| Next    | `https://netoun.github.io/bonne-garde-toolkit/next/` | `main`, with an "unreleased" banner linking back to the release docs |

A Pages deployment replaces the whole site, so every run (a push to `main`, a tag, or by hand) rebuilds both and deploys them together. A tag cut from a commit older than this workflow runs the old one, which deploys the release alone and drops `/next/` until the next push to `main`.

The tarball is JavaScript that runs on Node ≥ 22.12 and on Bun: one bundled bin, `templates/base` embedded, `packages/schema` and `packages/registry` vendored into the bundle (no `workspace:` dependency), and the npm dependencies it imports pinned exactly. Golden runs the packed bin with `node`.

CI runs `verify`, then `golden`. Before tagging, the intentions lint must pass.

## Upgrades

A project owns its code from day one, so upstream changes cannot land as a merge. Each release ships migration intentions in `migrations/vX.Y.Z/NN-slug.md`, in the format of [MODULES.md](./MODULES.md#tier-3-intentions) (`kind: migration`, id `vX.Y.Z/<slug>`, `domain` a category the project tracks). The release README lists every id (`bonne-garde intentions lint` fails when stale), or says in prose that the release has no migration. Template: `migrations/TEMPLATE.md`.

Maintainers, on each release: classify every meaningful change, add the intentions, run the lint, link the intention set in the changelog.

The planned `upgrade` command (not implemented yet; only `record` and the intentions lint exist) filters intentions to versions in `(current, target]`, domains the project tracks, minus ids already applied or skipped. A domain never installed is skipped, never force-added. It fetches tags into `refs/bg/v*`, so app tags never collide. Its steps:

| Step                                 | Behaviour                                                                                                  |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `upgrade status`, `upgrade path`     | Read only: version and readiness, then the plan                                                            |
| `upgrade prepare --to <ver\|latest>` | Needs a clean worktree; creates `upgrade/vA-to-vB` and writes `.bg/upgrade/`; never edits application code |
| `record <id>`                        | Shared with install intentions, after validation                                                           |
| `upgrade finish --to <ver>`          | Fails until every intention in range is applied or skipped, then advances `platform.version`               |

Out of scope: silent code rewrites, fork-and-merge as the upgrade path, reverting tier-3 changes, an independent version per module.
