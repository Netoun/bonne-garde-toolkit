# 4. Three tiers of change: copy, patch, intent

Status: accepted

## Context

Stanza installs deterministically with peer-matched adapters and codemods, and no agent. Boilerstone replays upgrades as intentions an agent proposes and a human confirms. Install and upgrade differ by one fact: at install the project state is known (manifest and owned regions), at upgrade it has diverged arbitrarily.

## Decision

Every change a module makes declares one tier. `copy` vendors files the module owns, `patch` is a named codemod that owns a region of a file the project owns, `intent` is a markdown intention a human or supervised agent applies. Tier 2 is preferred over tier 3. A failed patch becomes a pending intent: never a silent skip, never a failed install. A module with no tier-3 change installs with no agent.

## Consequences

- Tiers 1 and 2 are revertible through `files` and `regions` in `bg.json`; tier 3 is not, and `remove` lists it as manual cleanup.
- The patch catalog is closed. A new patch type is a platform change with its own tests.
- No free-text search and replace over project code, ever.
