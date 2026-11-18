# 1. One repository, an empty base, a CLI and two catalogs

Status: accepted

## Context

A boilerplate to clone ships every choice at once and cannot be upgraded once the project diverges. The earlier monorepo and the registry proof of concept lived in separate places, so one platform state needed two tags.

## Decision

One repository holds the base template (`templates/base`), the CLI, the UI and feature items (`registry/ui`, `registry/features`) and the modules (`registry/modules`). The base has no app, no package and no feature: `create` copies it and `add` composes the rest.

## Consequences

- A project is composed from pieces and owns every file it receives. Nothing depends on Bonne Garde at runtime.
- A change to the CLI, the template and the registry ships in one pull request and one tag.
- Anything the base would need to ship (an app, a package) is a module instead.
