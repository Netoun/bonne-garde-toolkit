# 030 — UI registry (shadcn)

## Objective

Define the shadcn-compatible catalog for front-end components and the features built from them. This registry is **tier 1 only**: pure file vendoring, no agent, no patch, no category.

Full-stack composition lives in [035](./035-module-registry.md). Do not extend this format to reach it.

## Why stay native

| Kept                                   | Cost of leaving                            |
| -------------------------------------- | ------------------------------------------ |
| A published schema people already know | Nobody can author a third-party item       |
| `registryDependencies` resolution      | Reimplementing a topo-sort we get for free |
| `shadcn add` interop on the same items | Consumers lose their existing tooling      |

Our components _are_ shadcn components. Forking the schema for them buys nothing.

## Canonical format

- Root [`registry/ui/registry.json`](../../registry/ui/registry.json) and [`registry/features/registry.json`](../../registry/features/registry.json) MUST conform to `https://ui.shadcn.com/schema/registry.json`.
- Item names MUST be unique across the resolved registry.
- File paths are relative to the declaring `registry.json`.
- `files[].target` of a UI item places components inside the `ui` module's package (`packages/ui/src/...`).
- `files[].target` of a feature item places files inside a front app (`apps/<web>/src/features/**`).

## Item kinds

| Kind    | Catalog             | Target                       | Needs module |
| ------- | ------------------- | ---------------------------- | ------------ |
| UI      | `registry/ui`       | `packages/ui/src/**`         | `ui`         |
| Feature | `registry/features` | `apps/<web>/src/features/**` | `auth`       |

A feature item is front-app source that imports the client of the module it needs. Both kinds are tier 1, and the consumer owns the copied files. A feature item is not module source: [035](./035-module-registry.md) forbids module source in `apps/*/src`, and states why feature items are the exception.

## Relation to the `ui` module

The `ui` category module ([035](./035-module-registry.md)) creates and owns `packages/ui` — its `package.json`, `tsconfig.json`, and Tailwind wiring. UI items only add components into it.

**Normative:**

- `bg add <ui-item>` MUST fail with an actionable message when no `ui` module is installed.
- Items MUST NOT create the host package, declare workspaces, or carry patches.
- UI item dependencies are merged into `packages/ui/package.json` by the `scripts.merge` / dependency path of the `ui` module, not by the item.

## Relation to the `auth` module

A feature item calls the session and the auth client, so it needs the `auth` module ([035](./035-module-registry.md)) the way a UI item needs `ui`.

**Normative:**

- `bg add <feature-item>` MUST fail with an actionable message when no `auth` module is installed, naming it.
- The failure is the same as for a UI item without `ui`: one rule, keyed on where the item's files land, not a `requires` field.

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
- `bg add <feature-item>` on a project without the `auth` module fails naming the missing module.
- `bg add button` twice is idempotent and reports the second run as skipped.
- Contract tests validate every `registry.json` against the published shadcn schema — not merely that expected names exist.
- No item in the catalog carries `meta.bg`.
