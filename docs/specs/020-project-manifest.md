# 020 — Project manifest (`bg.json`)

## Objective

Define the consumer-project state file written by `create`, updated by `add` / `record` / `remove`, and read by `doctor` and `upgrade`. It is the single source of truth for what the platform put in this project.

## Schema

```json
{
  "$schema": "./node_modules/create-bonne-garde/schema/project.json",
  "version": 2,
  "scope": "@acme",
  "platform": {
    "version": "0.2.0",
    "remote": "github:Netoun/bonne-garde-boilerplate",
    "intentions": { "applied": ["v0.2.0/align-bun-pin"], "skipped": {} }
  },
  "registries": { "@bg": "github:Netoun/bonne-garde-boilerplate@v0.2.0" },
  "apps": [{ "id": "api", "dir": "apps/api", "kind": "worker" }],
  "modules": {
    "auth": [
      {
        "id": "better-auth",
        "variant": "default",
        "version": "0.2.0",
        "installedAt": "2026-01-01T00:00:00.000Z",
        "options": { "withOrg": false },
        "patches": [{ "type": "ts.elysiaUse", "file": "apps/api/src/app.ts", "status": "applied" }],
        "intentions": { "applied": ["auth/better-auth/wire-auth-into-api"], "skipped": {} }
      }
    ]
  },
  "items": {
    "button": {
      "source": "@bg/button",
      "version": "0.2.0",
      "installedAt": "2026-01-01T00:00:00.000Z"
    }
  },
  "files": {
    "packages/ui/src/components/button.tsx": { "owner": "button", "sha256": "…" },
    "packages/auth/src/index.ts": { "owner": "auth/better-auth", "sha256": "…" }
  },
  "regions": {
    "package.json": { "workspaces[packages/auth]": "auth/better-auth" },
    "apps/api/src/app.ts": { "elysia[app].use[authModule]": "auth/better-auth" }
  }
}
```

## Fields

| Field        | Rules                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------ |
| `version`    | MUST be `2` for this revision (manifest schema version — not the platform semver)                |
| `scope`      | MUST match `^@[a-z0-9-]+$`                                                                       |
| `platform`   | Lockstep version + upgrade intention outcomes — see [090](./090-upgrades-and-intentions.md)      |
| `registries` | Map namespace → source (`local:<path>`, `github:owner/repo[@ref]`)                               |
| `apps`       | Declared apps: `id`, `dir` (traversal-safe, repo-relative), `kind`. Written by app-homed modules |
| `modules`    | Category → installed module records. `cardinality: one` categories MUST hold at most one record  |
| `items`      | shadcn UI items — see [030](./030-ui-registry.md)                                                |
| `files`      | Every tier-1 file written: owner + SHA-256 of what was written                                   |
| `regions`    | Tier-2 region ownership — see [060](./060-patches-and-regions.md)                                |

**No `capabilities` field.** It was a second, hand-maintained naming of what `modules` already states. Compatibility is decided by category + peers ([035](./035-module-registry.md)); UI item edges are decided by shadcn `registryDependencies`.

## Module record

| Field        | Rules                                                                    |
| ------------ | ------------------------------------------------------------------------ |
| `id`         | Module id within its category                                            |
| `variant`    | The selected variant `key` — MUST be recorded so upgrades can re-resolve |
| `version`    | SHOULD pin the lockstep platform semver; `"0.0.0"` for local/dev         |
| `options`    | Resolved consumer options, so a re-install is reproducible               |
| `patches`    | Outcome per patch (`applied` / `skipped` / `failed` + reason)            |
| `intentions` | `applied` list + `skipped` map — see [065](./065-intentions.md)          |

## Platform block

| Field                         | Rules                                                                                       |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `platform.version`            | Lockstep semver **without** leading `v`; set by `create`; advanced only by `upgrade finish` |
| `platform.remote`             | Platform git source used to fetch release tags / intentions                                 |
| `platform.intentions.applied` | Canonical ids `vX.Y.Z/slug`                                                                 |
| `platform.intentions.skipped` | Map id → human reason                                                                       |

- `create` MUST set `platform.version` and the default `@bg` registry pin to the running CLI's lockstep version — never `main`.
- Local/dev may use `"0.0.0"` and `local:…` registries; remote consumers MUST pin a tag.

## Normative

- MUST be created by `create` and updated atomically with a successful `add` / `record` / `remove`.
- MUST NOT be rewritten on `--dry-run`.
- Unknown future fields MUST be preserved with a warning (forward-compatible CLI); the `version` gate is the hard failure.
- Validation MUST live in the schema package, not in the CLI.

## Migration from v1

`version: 1` manifests (`installed`, `capabilities`) MUST be readable. The CLI rewrites them on first write: `installed` splits into `items` and `modules`, `capabilities` is dropped, `files` and `regions` start empty — meaning pre-v2 files are treated as user-owned until re-added. This is stated, not silent.

## Errors

- Missing / invalid `bg.json` → `add` fails with an actionable message.
- Unknown schema version → fail closed.
- `cardinality: one` category holding two records → fail closed as corrupt state.
