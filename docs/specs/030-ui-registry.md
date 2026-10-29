# 030 — UI registry (shadcn)

## Objective

Define the shadcn-compatible catalog for front-end components. This registry is **tier 1 only**: pure file vendoring, no agent, no patch, no category.

Full-stack composition lives in [035](./035-module-registry.md). Do not extend this format to reach it.

## Why stay native

| Kept                                   | Cost of leaving                            |
| -------------------------------------- | ------------------------------------------ |
| A published schema people already know | Nobody can author a third-party item       |
| `registryDependencies` resolution      | Reimplementing a topo-sort we get for free |
| `shadcn add` interop on the same items | Consumers lose their existing tooling      |

Our components _are_ shadcn components. Forking the schema for them buys nothing.

## Canonical format

- Root [`registry/ui/registry.json`](../../registry/ui/registry.json) MUST conform to `https://ui.shadcn.com/schema/registry.json`.
- Item names MUST be unique across the resolved registry.
- File paths are relative to the declaring `registry.json`.
- `files[].target` places components inside the `ui` module's package (`packages/ui/src/...`).

## Relation to the `ui` module

The `ui` category module ([035](./035-module-registry.md)) creates and owns `packages/ui` — its `package.json`, `tsconfig.json`, and Tailwind wiring. UI items only add components into it.

**Normative:**

- `bg add <ui-item>` MUST fail with an actionable message when no `ui` module is installed.
- UI items MUST NOT create the host package, declare workspaces, or carry patches.
- UI item dependencies are merged into `packages/ui/package.json` by the `scripts.merge` / dependency path of the `ui` module, not by the item.

## No `meta.bg`

The previous revision carried `meta.bg.provides` / `requires` / `conflicts` / `transforms` on UI items. All four are removed:

| Was                     | Now                                                                  |
| ----------------------- | -------------------------------------------------------------------- |
| `provides` / `requires` | Categories and peers, on modules only                                |
| `conflicts`             | Category cardinality — no field                                      |
| `transforms`            | Typed patches, on modules only ([060](./060-patches-and-regions.md)) |

A UI item that needs any of them is a module, not an item.

## Distribution

| Mode          | Use                                                        |
| ------------- | ---------------------------------------------------------- |
| Local path    | Monorepo development (`local:./registry`)                  |
| GitHub public | Publishing (`github:owner/repo@vX.Y.Z`) — no host required |
| Static JSON   | Optional later (`shadcn build` → flattened `dist/r`)       |

## Tracking

Installed items are recorded in `bg.json` under `items`, and every written file under `files` with its SHA-256 ([020](./020-project-manifest.md)). That is what makes re-adding idempotent and lets `doctor` detect user edits.

## Acceptance

- `bg list --items` shows all resolved items; `bg view button` prints valid registry-item JSON.
- `bg add button` on a project without the `ui` module fails naming the missing module.
- `bg add button` twice is idempotent and reports the second run as skipped.
- Contract tests validate every `registry.json` against the published shadcn schema — not merely that expected names exist.
- No item in the catalog carries `meta.bg`.
