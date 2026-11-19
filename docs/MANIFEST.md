# Project manifest (`bg.json`)

The state file `create` writes, `add` and `record` update, and `doctor` reads. It is the one record of what the platform put in a project.

```json
{
  "$schema": "./node_modules/bonne-garde/schema/project.json",
  "version": 2,
  "scope": "@acme",
  "platform": {
    "version": "0.3.0",
    "remote": "github:Netoun/bonne-garde-toolkit",
    "intentions": { "applied": [], "skipped": {} }
  },
  "registries": { "@bg": "github:Netoun/bonne-garde-toolkit@v0.3.0" },
  "apps": [{ "id": "api", "dir": "apps/api", "kind": "worker" }],
  "modules": {
    "auth": [
      {
        "id": "better-auth",
        "variant": "default",
        "version": "0.3.0",
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
      "version": "0.3.0",
      "installedAt": "2026-01-01T00:00:00.000Z"
    }
  },
  "files": { "packages/auth/src/index.ts": { "owner": "auth/better-auth", "sha256": "…" } },
  "regions": { "apps/api/src/app.ts": { "elysia[app].use[authModule]": "auth/better-auth" } }
}
```

| Field        | Rules                                                                                                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `version`    | The manifest schema version, `2`. Unknown version: fail closed                                                                                                                                          |
| `scope`      | `^@[a-z0-9-]+$`                                                                                                                                                                                         |
| `platform`   | `version`: lockstep semver without `v`, set by `create`. `remote`: git source for tags. `intentions`: outcomes of release intentions                                                                    |
| `registries` | Namespace → source (`local:<path>`, `github:owner/repo[@ref]`). Remote projects pin a tag, never `main`                                                                                                 |
| `apps`       | `id`, `dir` (repo-relative, traversal-safe), `kind`; written by app-homed modules                                                                                                                       |
| `modules`    | Category → records. A `one` category holds at most one, else the state is corrupt. A record keeps `variant`, `options`, patch outcomes and its `intentions` (`applied` list, `skipped` map id → reason) |
| `items`      | Installed UI and feature items                                                                                                                                                                          |
| `files`      | Every tier-1 file written: owner and SHA-256 of the bytes written                                                                                                                                       |
| `regions`    | Tier-2 ownership: file → region key → owner (`<category>/<id>`, or an item for the dependencies it wrote)                                                                                               |

Rules: `create` and a successful `add` / `record` write it atomically; `--dry-run` never does. Unknown fields are preserved with a warning. Validation lives in `packages/schema`. A v1 manifest (`installed`, `capabilities`) is read and rewritten as v2 on the next write, with `files` and `regions` empty, so older files count as user-owned until re-added.

## Regions

A region is the part of a file a patch owns: `workspaces[packages/auth]`, `scripts.<key>`, `dependencies.<name>`, `imports[<specifier>]`, `elysia[<target>].use[<argument>]`. A key segment holding `.`, `[`, `]`, `"` or `\` is written as a JSON string (`dependencies."lodash.merge"`).

| Rule         | Detail                                                                                |
| ------------ | ------------------------------------------------------------------------------------- |
| Write        | A successful patch records every region it wrote                                      |
| Re-apply     | Regions all present and equal: `skipped`                                              |
| Conflict     | Two modules claiming one region: the second install fails naming both                 |
| Foreign edit | A region present but differing from the record is user-owned; `--force` overwrites it |
| Revert       | `remove` deletes exactly the recorded regions                                         |

An applied intention is a region too: `record <id>` writes `intent[<id>]` on each file its Reference Paths mark `adapt`, owned by the intention's module, so another module's edit is not reported as user-modified. `doctor` checks only that the module's `applied` list holds the id. `record --skip` records no region and removes one an earlier record left.

## Checksums

`files` holds the owner and SHA-256 of what was written (the bytes, for a binary file). Against the disk:

| State       | Meaning         | Behaviour                                           |
| ----------- | --------------- | --------------------------------------------------- |
| equal       | untouched       | overwritten freely on re-add                        |
| differs     | user-modified   | `add` fails listing the paths; `--force` overwrites |
| file absent | deleted by user | reported by `doctor`; re-created only by `add`      |

A file with recorded regions is checked region by region, because a patch changes its whole-file hash. Its recorded sha is that of the file as its owner wrote it, so the owner added again keeps a file another module patched.

## Conflict policy

| Situation                                          | Default                                                                                                        |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Target file missing                                | create                                                                                                         |
| Target identical to the recorded sha               | keep, `skipped`                                                                                                |
| Target without regions differs from the sha, `add` | error listing every path; `--force` overwrites                                                                 |
| Same, `upgrade`                                    | keep and report; `--force` overwrites                                                                          |
| Target file recorded for another owner             | error naming both; `--force` takes it over                                                                     |
| Target with regions, edited since written, `add`   | keep, `kept`; only the regions written are classified; `--force` overwrites a differing region, never the file |
| Region present and equal                           | `skipped`                                                                                                      |
| Region present and differing                       | error; `--force` overwrites                                                                                    |
| Region owned by another module                     | error, `--force` does not bypass                                                                               |
| Category already filled (`one`)                    | error, use `replace`                                                                                           |

`add` fails on a modified file because it asks for a module whole; `upgrade` keeps the user's edit because it moves a project forward.
