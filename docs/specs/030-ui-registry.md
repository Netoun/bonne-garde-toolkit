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
- A feature item with pages ships their routes as `apps/<web>/src/features/<feature>/routes.ts`, a default export of route entries with paths relative to `src`, which the app's `routes.ts` composes. No item edits a file a module owns.

## Item kinds

| Kind    | Catalog             | Target                       | Needs module                           |
| ------- | ------------------- | ---------------------------- | -------------------------------------- |
| UI      | `registry/ui`       | `packages/ui/src/**`         | `ui`, from where its files land        |
| Feature | `registry/features` | `apps/<web>/src/features/**` | the ones its `meta.needsModules` names |

A feature item is front-app source that imports the client of the module it needs. Both kinds are tier 1, and the consumer owns the copied files. A feature item is not module source: [035](./035-module-registry.md) forbids module source in `apps/*/src`, and states why feature items are the exception.

## Relation to the `ui` module

The `ui` category module ([035](./035-module-registry.md)) creates and owns `packages/ui` — its `package.json`, `tsconfig.json`, and Tailwind wiring. UI items only add components into it.

**Normative:**

- `bg add <ui-item>` MUST fail with an actionable message when no `ui` module is installed.
- Items MUST NOT create the host package, declare workspaces, or carry patches.
- UI item dependencies are merged into `packages/ui/package.json` by the `scripts.merge` / dependency path of the `ui` module, not by the item.

## The modules a feature item needs

A feature item calls the session and the auth client, and lands in an app a `web` module owns, so it needs those modules ([035](./035-module-registry.md)) the way a UI item needs `ui`. What a UI item needs follows from where its files land, because every one lands in the same package. What a feature item needs does not (the app it lands in, `storage` for an upload), so it says so.

**Normative:**

- A feature item names the modules it needs in `meta.needsModules`, a list of entries that are each a category (`auth`: any module of it) or a `<category>/<id>` (`web/spa`: that module, since the item lands in `apps/spa`). It always names `auth`.
- `bg add <feature-item>` MUST fail with an actionable message when a module it needs is neither installed nor named in the same call, naming every missing one at once and the command that installs them. The failure is the same as for a UI item without `ui`.
- A UI item names no module: `bg add` finds `ui` by where its files land.

## No `meta.bg`

The previous revision carried `meta.bg.provides` / `requires` / `conflicts` / `transforms` on UI items. All four are removed:

| Was                     | Now                                                                  |
| ----------------------- | -------------------------------------------------------------------- |
| `provides` / `requires` | Categories and peers, on modules only                                |
| `conflicts`             | Category cardinality — no field                                      |
| `transforms`            | Typed patches, on modules only ([060](./060-patches-and-regions.md)) |

A UI item that needs any of them is a module, not an item.

`meta.needsModules` is the one key of `meta` this platform reads, on feature items only. It is not `requires` back under another name: `requires` repeated a `registryDependencies` edge between items, and this names modules, which no item field can, and carries a rule `bg add` enforces.

## Dependencies

An item's `dependencies` and `devDependencies` are shadcn's. An entry written `name@version` is added by `bg add` to the `package.json` of the app or package its files land in, where the formatter sorts it, as `package.dependencies` adds a module's ([060](./060-patches-and-regions.md)); a workspace dependency is written `@acme/<package>@workspace:*`, with the scope rendered. The item carries no patch: it declares shadcn's field, and `bg add` writes it. A bare `name` records what the files import and is written by nobody, because the module that owns the package already pins it (the `ui` module installs the union of its items'). An item whose files land in more than one workspace MUST NOT declare a `name@version`.

## Distribution

| Mode          | Use                                                        |
| ------------- | ---------------------------------------------------------- |
| Local path    | Monorepo development (`local:./registry`)                  |
| GitHub public | Publishing (`github:owner/repo@vX.Y.Z`) — no host required |
| Static JSON   | Optional later (`shadcn build` → flattened `dist/r`)       |

## Tracking

Installed items are recorded in `bg.json` under `items`, and every written file under `files` with its SHA-256 ([020](./020-project-manifest.md)). That is what makes re-adding idempotent and lets `doctor` detect user edits. The dependencies an item wrote are recorded as the regions it owns.

## Acceptance

- `bg list --items` shows all resolved items; `bg view button` prints valid registry-item JSON.
- `bg add button` on a project without the `ui` module fails naming the missing module.
- `bg add <feature-item>` on a project without a module its `meta.needsModules` names fails naming every missing one, before anything is written.
- `bg add <feature-item>` writes its `name@version` dependencies into the app's `package.json`; `bg doctor --strict` is green after it, and a second add reports its dependency patch skipped and changes nothing.
- `bg add button` twice is idempotent and reports the second run as skipped.
- Contract tests validate every `registry.json` against the published shadcn schema — not merely that expected names exist.
- No item in the catalog carries `meta.bg`.
