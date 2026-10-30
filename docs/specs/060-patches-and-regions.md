# 060 — Patches and regions

## Objective

Define tier 2: named, typed, idempotent structural edits to files the consumer project owns, with recorded ownership so they can be reverted and re-applied.

Tier 1 (`copy`) needs none of this — the module owns the whole file. Tier 3 (`intent`) is the escape hatch for what no named patch can express ([065](./065-intentions.md)).

## Patch catalog (normative)

The catalog is closed. A module MUST NOT invent a patch type; adding one is a platform change with its own spec entry and tests.

| `type`              | Args                                                | Target                              | Owned region                           |
| ------------------- | --------------------------------------------------- | ----------------------------------- | -------------------------------------- |
| `jsonc.merge`       | `file`, `value`                                     | any JSON / JSONC                    | each leaf dot-path written             |
| `env.append`        | `file`, `lines`                                     | `.dev.vars.example`, `.env.example` | each `KEY`                             |
| `workspace.add`     | `name`, `path`, `dependencies?`, `devDependencies?` | root `package.json`                 | `workspaces[<path>]`                   |
| `scripts.merge`     | `file`, `scripts`                                   | any `package.json`                  | `scripts.<key>`                        |
| `ts.addImport`      | `file`, `moduleSpecifier`, `namedImports`           | `.ts` / `.tsx`                      | `imports[<specifier>]`                 |
| `ts.addNamedExport` | `file`, `moduleSpecifier`, `exports`                | `.ts` / `.tsx`                      | `exports[<specifier>]`                 |
| `ts.elysiaUse`      | `file`, `targetName`, `argument`                    | Elysia seam file                    | `elysia[<targetName>].use[<argument>]` |

**Implementation rules:**

- JSON/JSONC edits MUST go through `jsonc-parser` `modify` + `applyEdits` — comments and formatting survive.
- TypeScript edits MUST go through `ts-morph`. Never regex, never string concatenation.
- Every patch MUST be idempotent: applying it twice yields `applied` then `skipped`, and an identical tree.
- A patch MUST NOT perform free-text search/replace across arbitrary source.
- Scope placeholder rewriting (`{{SCOPE}}`) happens at template render time on tier-1 files only — it is **not** a patch and MUST NOT run over project-owned files.
- A tier-1 file that carries the scope MUST be what the project's formatter writes at **every** scope `create` accepts, not only at the scope it was authored for. The scope changes line lengths, so the checksum `bg.json` records would otherwise be of a file `bun run check` rejects, and fixing it by hand makes `doctor` report it user-modified. A line whose wrap depends on the scope carries `// oxfmt-ignore`; `packages/cli/src/scope-format.test.ts` renders every item and module at every length and fails on the first file the formatter would change.

## Region ownership

`bg.json` records which module owns which region of which file ([020](./020-project-manifest.md)):

```json
"regions": {
  "package.json": {
    "workspaces[packages/auth]": "auth/better-auth",
    "scripts.auth:secret": "auth/better-auth"
  },
  "apps/api/src/app.ts": {
    "elysia[app].use[authModule]": "auth/better-auth"
  }
}
```

| Rule         | Detail                                                                                                                     |
| ------------ | -------------------------------------------------------------------------------------------------------------------------- |
| Write        | A successful patch MUST record every region it wrote                                                                       |
| Re-apply     | A patch whose regions are all present and equal is `skipped`, not `applied`                                                |
| Conflict     | Two modules claiming the same region is an error — the second install fails naming both                                    |
| Revert       | `bg remove` deletes exactly the recorded regions and nothing else                                                          |
| Foreign edit | A region present but differing from what was recorded is **user-owned**; the patch MUST NOT overwrite it without `--force` |

## Checksums (tier 1)

For every copied file, `bg.json` records the owner and the SHA-256 of what was written. That is what lets `add`, `doctor`, and `upgrade` tell three states apart:

| Recorded sha vs disk | Meaning         | Default behavior                                      |
| -------------------- | --------------- | ----------------------------------------------------- |
| equal                | untouched       | overwrite freely on re-add                            |
| differs              | user-modified   | see the conflict policy: `add` fails, `upgrade` keeps |
| file absent          | deleted by user | report in `doctor`; re-create only on explicit `add`  |

**A file with recorded regions is checked region by region.** A patch rewrites a file whose tier-1 sha `bg.json` recorded, so the whole-file sha no longer matches and says nothing about a user edit. `doctor` skips the sha check for that file and reports its regions instead ([Region ownership](#region-ownership)). The conflict policy below classifies it by region too: the sha rows apply to a file without recorded regions.

## Patch outcomes

A patch result is `applied`, `skipped`, or `failed` with a reason. Recorded in `bg.json` alongside the module.

**Degradation (normative):** a `failed` patch MUST NOT abort the whole install and MUST NOT be silently ignored. It is converted into a pending tier-3 intent carrying the patch's intent, target file, and failure reason. `doctor` reports it; the executor protocol of [065](./065-intentions.md) resolves it.

## Staging

- All tier-1 and tier-2 writes MUST be computed in a virtual tree before any disk write.
- `--dry-run` MUST print the full plan — files, regions, deps, env keys, pending intents — and write nothing.
- Disk application MUST be all-or-nothing: on any error mid-write, the tree is restored and `bg.json` is unchanged.

## Conflict policy

| Situation                                                        | Default                                                          |
| ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| Target file missing                                              | create                                                           |
| Target file identical to recorded sha                            | keep, report `skipped`                                           |
| Target file without regions differs from recorded sha, `add`     | error listing every path; `--force` overwrites                   |
| Target file without regions differs from recorded sha, `upgrade` | keep, report; `--force` overwrites                               |
| Target file recorded for another owner                           | error naming both owners; `--force` takes it over and reports it |
| Region present and equal                                         | `skipped`                                                        |
| Region present and differing                                     | error; `--force` overwrites                                      |
| Region owned by another module                                   | error always — `--force` does not bypass                         |
| Category already filled (`cardinality: one`)                     | error always — use `bg replace`                                  |

`add` and `upgrade` differ on a user-modified file on purpose. `add` is a request to install a module whole: keeping the user's file would record the module as installed without that file, so it fails and names the paths. `upgrade` moves an installed project forward: it keeps the user's edit and reports it.

## Acceptance

- Adding `auth` to a project with an `api` creates `packages/auth`, registers the workspace, merges env keys, and inserts one `.use()` — without reformatting `app.ts`.
- Re-running the same `add` reports every patch `skipped` and leaves the tree byte-identical.
- Hand-editing a patched region then re-adding reports the region as user-owned and does not overwrite it.
- `bg remove auth` removes `packages/auth` and exactly the recorded regions.
- A patch made to fail (missing seam file) yields a pending intent, not a failed install.
