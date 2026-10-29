# 035 — Module registry

## Objective

Define the native Bonne Garde format for full-stack modules: category-typed units installed into their own workspace package, composing by peers rather than by hand-written conflict lists.

The shadcn schema stays for UI items ([030](./030-ui-registry.md)). It cannot express categories, peers, variants, or patches — modules MUST NOT be squeezed into it.

## Categories (normative)

A module fills exactly one category. The category carries **cardinality** and **home**; nothing else declares conflicts.

| id         | cardinality | home                        | Notes                         |
| ---------- | ----------- | --------------------------- | ----------------------------- |
| `tooling`  | one         | repo                        | fmt / lint / check / hooks    |
| `api`      | one         | app `apps/api`              | Elysia Worker shell           |
| `db`       | one         | package `packages/db`       | D1 binding + client           |
| `orm`      | one         | package `packages/db`       | Shares the `db` directory     |
| `auth`     | one         | package `packages/auth`     |                               |
| `ui`       | one         | package `packages/ui`       | Host package for shadcn items |
| `email`    | one         | package `packages/email`    |                               |
| `queue`    | one         | package `packages/queue`    |                               |
| `storage`  | one         | package `packages/storage`  |                               |
| `payments` | one         | package `packages/payments` |                               |
| `web`      | many        | app `apps/<id>`             | SPA / SSR / static shells     |
| `testing`  | many        | app                         |                               |
| `deploy`   | many        | repo                        | wrangler / CI                 |

**Rules:**

- Order is topological: a category appears after every category it may peer on; `many` categories come last.
- `cardinality: one` means at most one installed module per category (per app for app-homed categories). A second one is a **conflict by construction** — no `conflicts` field exists.
- `home` fixes where the module's code lands. Swapping a provider replaces the contents of that package; application code is never touched.

## Package-dedicated seam (normative)

- A module with a `package` home MUST write only inside its own package, plus tier-2 patches on known seams.
- Application code MUST consume a module through its package export, never through paths internal to it.
- MUST NOT write module source directly into `apps/*/src` — that is what makes swap and revert impossible.

## Module document

One directory per module: `registry/modules/<category>/<id>/`.

```text
registry/modules/auth/better-auth/
  module.json
  README.md              # human docs
  intent/
    01-wire-auth-into-api.md
  template/              # tier 1, mirrors the target tree
    packages/auth/package.json
    packages/auth/src/index.ts
```

### `module.json`

```json
{
  "$schema": "https://bonne-garde.dev/schema/module.json",
  "id": "better-auth",
  "category": "auth",
  "version": "0.2.0",
  "title": "Better Auth",
  "description": "Session auth with email/password and verification.",
  "peers": { "db": ["d1"], "orm": ["drizzle"] },
  "consumesPackages": ["db"],
  "options": {
    "withOrg": {
      "description": "Organization primitives",
      "default": false,
      "values": [true, false]
    }
  },
  "checks": ["bun run typecheck", "bun run test"],
  "variants": [
    {
      "key": "default",
      "match": {},
      "workspace": { "name": "{{SCOPE}}/auth", "path": "packages/auth" },
      "dependencies": { "better-auth": "1.4.2" },
      "devDependencies": {},
      "env": [{ "name": "BETTER_AUTH_SECRET", "required": true, "example": "" }],
      "copy": ["packages/auth/**"],
      "patch": [
        {
          "type": "ts.elysiaUse",
          "file": "apps/api/src/app.ts",
          "targetName": "app",
          "argument": "authModule"
        }
      ],
      "intent": ["01-wire-auth-into-api.md"]
    }
  ]
}
```

| Field              | Rules                                                                                              |
| ------------------ | -------------------------------------------------------------------------------------------------- |
| `id`               | Unique within its category; kebab-case                                                             |
| `category`         | MUST be a category id from the table above                                                         |
| `version`          | Informational; the lockstep platform semver is authoritative ([070](./070-testing-and-release.md)) |
| `peers`            | Map category → allow-list of module ids. Empty array means "any module of that category"           |
| `consumesPackages` | Workspace packages this module imports; used to validate the install graph                         |
| `options`          | Consumer-facing toggles, resolved before variant selection and recorded in `bg.json`               |
| `checks`           | Commands run after install to validate the added surface                                           |
| `variants`         | Install payloads — see below                                                                       |

### Variants

The combinatorial explosion is data, not branching code. A module ships one variant per peer combination it supports.

| Field                              | Rules                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------- |
| `key`                              | Stable identifier for the combination; recorded in `bg.json`                                   |
| `match`                            | `Partial<Record<Category, ModuleId>>`. `{}` is the default variant                             |
| `workspace`                        | Workspace package to create (name + path). Derived from `home` unless overridden               |
| `dependencies` / `devDependencies` | Exact version maps written into the **workspace package.json** — never duplicated elsewhere    |
| `env`                              | Env vars merged into `.dev.vars.example` / `.env.example`; existing keys are never overwritten |
| `copy`                             | Tier 1 — globs relative to `template/`, mirroring the target tree                              |
| `patch`                            | Tier 2 — typed patches, see [060](./060-patches-and-regions.md)                                |
| `intent`                           | Tier 3 — intention filenames under `intent/`, see [065](./065-intentions.md)                   |

**Selection:** the most specific `match` satisfied by the installed peers wins. Ties are a registry authoring error and MUST fail the contract test, not be resolved at runtime.

**Normative:**

- `template/` MUST mirror the target tree — no per-file `target` mapping. The path _is_ the destination.
- A variant MUST NOT declare a dependency both in `dependencies` and in a vendored `package.json`. The workspace `package.json` is generated from `dependencies`; it is not authored by hand.
- A module MUST declare peers by category, never by capability string.

## Errors

| Case                                         | Behavior                                                        |
| -------------------------------------------- | --------------------------------------------------------------- |
| Unknown module                               | Fail with suggestions from `search`                             |
| Category already filled (`cardinality: one`) | Fail naming the installed module and the `--replace` path       |
| Missing peer                                 | Fail listing the category and its allow-list                    |
| Peer outside the allow-list                  | Fail naming the incompatible module                             |
| No variant matches                           | Fail listing the installed peers and the available `match` keys |

## Acceptance

- `bg list --category auth` shows every auth module.
- `bg add better-auth` on a project without an `orm` fails naming the missing peer.
- Installing a second `auth` module fails without any `conflicts` field existing in the schema.
- A module with only `copy` and `patch` installs non-interactively in CI.
- Contract tests reject a module whose `match` set is ambiguous or whose category is unknown.
