# 5. Compatibility by category cardinality and peers

Status: accepted

## Context

Our first draft carried a hand-maintained `conflicts: []`, a flat `requires: ["db"]` capability, and one item per combination (`auth-drizzle`, `auth-prisma`). Each is wrong by the fifth module: they model the constraint instead of the domain.

## Decision

A module fills one category. A category has a cardinality (`one` or `many`) and a home. A second module in a `one` category is a conflict by construction, so no `conflicts` field exists. A module declares `peers` by category, with an optional allow-list of module ids, and ships one `variant` per peer combination it supports, chosen by the most specific `match`.

## Consequences

- Combinations are data in `module.json`, not branches in the CLI.
- The category order is topological (a category comes after every category it peers on, `many` categories last). `MODULE_CATEGORIES` in `packages/schema` is the single source, and the contract test checks every module against it.
- A variant `match` tie is an authoring error that fails the contract test.
