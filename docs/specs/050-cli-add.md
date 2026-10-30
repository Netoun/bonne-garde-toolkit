# 050 — CLI compose (`add` / `list` / `search` / `view` / `doctor` / `remove`)

## Objective

Define post-create composition. One `add` handles both catalogs: shadcn UI items ([030](./030-ui-registry.md)) and native modules ([035](./035-module-registry.md)).

## Commands

```bash
bg list [--category <cat>] [--items] [--source <source>]
bg search <query> [--source <source>]
bg view <name> [--source <source>]
bg add <name...> [--dry-run] [--force] [--no-install] [--yes] [--set key=value] [--source <source>]
bg replace <name> [--dry-run]          # swap the module filling a `cardinality: one` category
bg remove <name> [--dry-run]           # revert tier 1 + tier 2; tier 3 is reported, not undone
bg record <intention-id> [--skip "<reason>"]
bg doctor [--json] [--strict]
```

## `add` algorithm (MUST)

1. Load and validate `bg.json`; fail closed on an unknown schema version.
2. Resolve the registry source(s); load both catalogs.
3. Classify each requested name as **item** or **module**.
4. Resolve the graph: `registryDependencies` for items, `peers` + `consumesPackages` for modules.
5. Check category cardinality against `modules`; a filled `one` category fails pointing at `bg replace`.
6. Resolve `options` (flags, then defaults; prompts only on a TTY without `--yes`).
7. Select one **variant** per module by most-specific `match` over the resolved peers.
8. Build the plan: files, regions, workspace packages, deps, env keys, checks, pending intents.
9. Print the plan. If `--dry-run`, stop — no disk write, no `bg.json` write.
10. Stage tier 1 and tier 2 in a virtual tree; classify every target against `files` / `regions` ([060](./060-patches-and-regions.md)).
11. Apply to disk all-or-nothing. Convert every `failed` patch into a pending intent.
12. Update `bg.json`: `modules` / `items`, `files` (sha256), `regions`, `apps`, patch outcomes.
13. Unless `--no-install`, run `bun install`.
14. Stage pending intents into `.bg/session.md` and print the executor entry point ([065](./065-intentions.md)).
15. Run the modules' `checks` when nothing is pending; report but do not roll back on failure.

**Normative:**

- Steps 1–13 MUST be fully deterministic. A plan with zero pending intents MUST complete with no agent in the loop and no TTY.
- Dependencies MUST come from the variant and nowhere else: written into the workspace `package.json` generated from it, or merged into the module's vendored `package.json`, which carries no dependency maps of its own ([035](./035-module-registry.md)).
- `--yes` MUST be honoured: it selects defaults for every `option` and never prompts. It is not a no-op flag.
- MUST support `local:` sources for monorepo development and `github:owner/repo@ref` for consumers, with the same UX for both, for **install** and not only for index fetch.

## `doctor`

Reads `bg.json` and the tree, no network. Reports:

| Check      | Signal                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Manifest   | Schema version, module and item counts                                                                                       |
| Files      | Missing, user-modified (sha mismatch), untracked-but-expected. A file with recorded regions is checked by region, not by sha |
| Regions    | Present / missing / owned by another module / foreign edit                                                                   |
| Patches    | Recorded `failed` outcomes                                                                                                   |
| Intentions | Pending (staged, unresolved), applied, skipped                                                                               |
| Peers      | A module whose peer category is now empty                                                                                    |

`--strict` exits non-zero on warning or error, for CI.

## `remove` and `replace`

- `remove` deletes files whose recorded sha still matches, deletes exactly the recorded regions, and drops the module record. Files the user modified are **kept** and reported.
- `replace` is `remove` then `add` of the new module in the same category, in one plan and one atomic apply.
- Tier-3 changes cannot be reverted: both commands MUST list the applied intention ids as manual cleanup.

## Errors

| Case                                | Behavior                                                |
| ----------------------------------- | ------------------------------------------------------- |
| Unknown name                        | Fail with suggestions from `search`                     |
| Missing peer category               | Fail listing the category and its allow-list            |
| Peer outside allow-list             | Fail naming the incompatible module                     |
| Category already filled             | Fail pointing at `bg replace`                           |
| No variant matches                  | Fail listing installed peers and available `match` keys |
| Collision with a user-modified file | Fail listing paths; `--force` overwrites                |
| Region owned by another module      | Fail always — `--force` does not bypass                 |

## Acceptance

- `bg add email --dry-run` prints files, regions, env keys, deps and pending intents, and leaves the tree byte-identical.
- `bg add email` twice is idempotent: second run reports every file and region as skipped.
- `bg add better-auth` without an `orm` fails naming the missing peer, before writing anything.
- `bg add api ui button --yes --no-install` completes in CI with no TTY.
- `bg doctor --strict` is green immediately after a clean `add` with no pending intents.
- `bg remove email` restores the tree to its pre-add state except for user-modified files and applied intents.
