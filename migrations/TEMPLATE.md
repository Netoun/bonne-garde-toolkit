---
id: vX.Y.Z/slug
domain: tooling
classification: migration
requires:
  - vX.Y.Z/other-slug
---

# Migration Intention Template

> Frontmatter must start on the first line — the parser only reads it there.

## Filename

Name the file `NN-slug.md`, where `NN` is a zero-padded execution-order prefix (`00`, `01`, `02`, …). Filename sort order within a release directory **is** the execution order. The frontmatter `id:` never carries the `NN-` prefix. `bg intentions lint` validates every `requires:` entry against this order.

## Metadata

- `id`: stable identifier recorded in `bg.json` → `platform.intentions` (`vX.Y.Z/slug`)
- `domain`: capability / surface the consumer tracks (`tooling`, `api`, `ui`, `auth`, `db`, …)
- `classification`: `informational` | `migration` | `breaking-manual`
- `requires`: ids that must be applied or staged first (optional)

## Goal

## Why

## Applies When

## Do Not Apply When

- Prior stacks this intention migrates away from are **not** skip reasons.

## Observable Gaps

## Out of Scope

## Reference Paths

- `path/in/repo` — `copy` | `adapt`

## Validation

## Record Result

- Applied → `bg record <id>`
- Skipped → `bg record <id> --skip "…"`
