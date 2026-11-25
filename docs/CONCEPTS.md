# Concepts

What the platform is made of and the words used for it. The decisions behind them are in [`adr/`](./adr).

## Vocabulary

| Term         | Meaning                                                                                                                     |
| ------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **Base**     | The empty monorepo `create` copies: tooling and conventions, no app, no package, no feature                                 |
| **Item**     | A shadcn registry entry (UI component or feature block): files copied into the project, nothing else                        |
| **Module**   | A full-stack unit of one **category**, installed into its own workspace package; see [MODULES.md](./MODULES.md)             |
| **Category** | The slot a module fills (`auth`, `db`, ...), with a **cardinality** (`one` or `many`) and a **home**                        |
| **Peer**     | A category (optionally an allow-list of module ids) a module needs installed                                                |
| **Variant**  | An install payload of a module, chosen by matching the installed peers                                                      |
| **Adapter**  | A runtime provider inside a vendored package (`memory` / `cloudflare`); never an install-time concept                       |
| **Patch**    | A named, typed, idempotent edit to a file the project owns                                                                  |
| **Intent**   | A markdown intention a human or supervised agent applies; see [MODULES.md](./MODULES.md#tier-3-intentions)                  |
| **Manifest** | `bg.json` in a project: what was installed, which file and region belongs to which module; see [MANIFEST.md](./MANIFEST.md) |

## Three tiers

Every change a module makes declares one tier.

| Tier           | Mechanism                         | Agent? | Reversible     | Use for                                      |
| -------------- | --------------------------------- | ------ | -------------- | -------------------------------------------- |
| **1 `copy`**   | Verbatim file copy                | no     | yes (checksum) | New files the module fully owns              |
| **2 `patch`**  | Named codemod owning a **region** | no     | yes (region)   | Structural edits to files the project owns   |
| **3 `intent`** | Markdown intention, confirmed     | yes    | no             | What tier 2 cannot express, and all upgrades |

A module with no tier-3 change installs with no agent. Tier 2 wins over tier 3 whenever a named patch can express the change. A failed patch becomes a pending intent, never a silent skip.

## Categories

The order is topological: a category comes after every category it may peer on, `many` categories last. `MODULE_CATEGORIES` in `packages/schema/src/module-manifest.ts` is the one place it is written.

| id              | cardinality | home                             | Notes                                                                               |
| --------------- | ----------- | -------------------------------- | ----------------------------------------------------------------------------------- |
| `pm`            | one         | repo                             | Package manager: owns the `packageManager` pin, its workspace file and the CI setup |
| `provider`      | one         | repo                             | Runtime and deploy target; owns the runtime seam (`packages/api-runtime`)           |
| `tooling`       | one         | repo                             | fmt / lint / check / hooks                                                          |
| `config`        | one         | package `packages/config`        | Branding constants and assets every app imports                                     |
| `api`           | one         | app `apps/api`                   | Elysia app shell                                                                    |
| `db`            | one         | package `packages/db`            | Binding and client; provider-matched                                                |
| `orm`           | one         | package `packages/db`            | Shares the `db` directory                                                           |
| `auth`          | one         | package `packages/auth`          |                                                                                     |
| `ui`            | one         | package `packages/ui`            | Host package for the UI items                                                       |
| `email`         | one         | package `packages/email`         |                                                                                     |
| `queue`         | one         | package `packages/queue`         |                                                                                     |
| `storage`       | one         | package `packages/storage`       |                                                                                     |
| `realtime`      | one         | package `packages/realtime`      | Rooms over WebSocket, one variant per provider                                      |
| `payments`      | one         | package `packages/payments`      |                                                                                     |
| `observability` | one         | package `packages/observability` | Error reporting; provider-matched                                                   |
| `launch`        | one         | package `packages/launch`        | Pre-launch: launch stage and waiting list; provider-matched                         |
| `web`           | many        | app `apps/<id>`                  | SPA / SSR / static shells                                                           |
| `testing`       | many        | app                              |                                                                                     |
| `deploy`        | many        | repo                             | CI / deploy pipeline                                                                |
| `dev`           | many        | repo                             | Local launchers (named HTTPS URLs); never on the runtime path                       |

- `api`, `db`, `storage`, `realtime`, `observability`, `launch`, `web` and `deploy` declare `peers.provider` and ship one variant per provider they support.
- A category's note never names a provider's technology (`D1`, `R2`, `wrangler`): that belongs to the provider's modules.
- `cardinality: one` means one module per category (per app for app-homed ones). A second is a conflict by construction.

## Package seam

- A module with a `package` home writes only inside its package, plus tier-2 patches on known seams.
- Application code consumes a module through its package export, never through its internal paths.
- A module that is not app-homed never writes source into `apps/*/src`.
- An app-homed module (`api`, `web`) is the app: it writes under `apps/<id>/`, and swapping it replaces the app.
- Feature items copy into `apps/<web>/src/features/**`: a tier-1 copy the consumer owns, the one exception.

## Items

UI and feature items keep the shadcn schema untouched ([`registry/ui`](../registry/ui/registry.json), [`registry/features`](../registry/features/registry.json)).

| Kind    | Catalog             | Target                       | Needs                                        |
| ------- | ------------------- | ---------------------------- | -------------------------------------------- |
| UI      | `registry/ui`       | `packages/ui/src/**`         | the `ui` module, found from where files land |
| Feature | `registry/features` | `apps/<web>/src/features/**` | the modules its `meta.needsModules` names    |

- Items are text-only: a binary file ships in a module. `add` and `registry:build` refuse a non-UTF-8 item file.
- An item creates no package, declares no workspace and carries no patch. No `meta.bg`.
- `meta.needsModules` lists categories (`auth`: any module of it) or `<category>/<id>` (`web/spa`). `add` fails naming every missing one before writing anything. A feature item always names `auth`.
- An item's `name@version` dependencies are written into the `package.json` of the app or package its files land in (workspace form: `@acme/<package>@workspace:*`). A bare `name` is written by nobody: the owning module already pins it. An item landing in several workspaces declares no `name@version`.
- A feature item with pages ships `src/features/<feature>/routes.ts`, a default export of route entries that the app's `routes.ts` composes. No item edits a file a module owns.

Sources: `local:<path>` for development, `github:owner/repo[@ref]` for consumers (read at the tag `platform.version` names), or the flattened `dist/r` from `bun run registry:build`.
