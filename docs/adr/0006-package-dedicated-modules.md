# 6. A module owns a workspace package; application code is patched only through the catalog

Status: accepted

## Context

Without ownership there is no revert, no provider swap, and no way to tell a user edit from an upstream change. "No auto-uninstall" was a consequence of that gap, not a decision.

## Decision

A module's code lands in a dedicated workspace package (`packages/auth`, `packages/db`, ...), and application code imports it through its package export. A module reaches `apps/*/src` only through tier-2 patches on known seams. App-homed modules (`api`, `web`) are the app and write under `apps/<id>/`. Feature items are the exception: a tier-1 copy the consumer owns, into `apps/<web>/src/features/**`.

## Consequences

- Swapping a provider replaces the contents of one package and leaves application code alone.
- `bg.json` records `files` (owner and SHA-256) and `regions` (owner per patched key), which is what `doctor`, `remove` and `upgrade` read.
- Code that predates its module, such as a runtime-provided import sitting in application code, breaks the swap and has to be lifted into a package first.
