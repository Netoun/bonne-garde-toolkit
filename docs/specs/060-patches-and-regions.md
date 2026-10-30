# 060 — Patches and regions

## Objective

Define tier 2: named, typed, idempotent structural edits to files the consumer project owns, with recorded ownership so they can be reverted and re-applied.

Tier 1 (`copy`) needs none of this — the module owns the whole file. Tier 3 (`intent`) is the escape hatch for what no named patch can express ([065](./065-intentions.md)).

## Patch catalog (normative)

The catalog is closed. A module MUST NOT invent a patch type; adding one is a platform change with its own spec entry and tests.

| `type`                 | Args                                                | Target                              | Owned region                                    |
| ---------------------- | --------------------------------------------------- | ----------------------------------- | ----------------------------------------------- |
| `jsonc.merge`          | `file`, `value`                                     | any JSON / JSONC                    | each leaf dot-path written                      |
| `env.append`           | `file`, `lines`                                     | `.dev.vars.example`, `.env.example` | each `KEY`                                      |
| `workspace.add`        | `name`, `path`, `dependencies?`, `devDependencies?` | root `package.json`                 | `workspaces[<path>]`                            |
| `scripts.merge`        | `file`, `scripts`                                   | any `package.json`                  | `scripts.<key>`                                 |
| `package.dependencies` | `file`, `dependencies?`, `devDependencies?`         | any `package.json`                  | `dependencies.<name>`, `devDependencies.<name>` |
| `ts.addImport`         | `file`, `moduleSpecifier`, `namedImports`           | `.ts` / `.tsx`                      | `imports[<specifier>]`                          |
| `ts.addNamedExport`    | `file`, `moduleSpecifier`, `exports`                | `.ts` / `.tsx`                      | `exports[<specifier>]`                          |
| `ts.elysiaUse`         | `file`, `targetName`, `argument`                    | Elysia seam file                    | `elysia[<targetName>].use[<argument>]`          |

**Implementation rules:**

- JSON/JSONC edits MUST go through `jsonc-parser` `modify` + `applyEdits` — comments and formatting survive.
- TypeScript edits MUST go through `ts-morph`. Never regex, never string concatenation.
- A region key is the leaf's path joined with dots, a segment holding `.`, `[`, `]`, `"` or `\`, or an empty one, being written as a JSON string (`dependencies."lodash.merge"`), so `scripts.merge` and `jsonc.merge` claim the same text for the same leaf.
- `jsonc.merge` writes an array whole as a leaf, lays out what it inserts like the file around it (objects expanded, an array of scalars on one line while it fits in 100 columns, trailing commas where the file uses them), and fails a leaf under a parent that is not an object.
- TypeScript patches parse the one file in memory with ts-morph's own compiler: no tsconfig, no module resolution, no type checker.
- `ts.addImport` and `ts.addNamedExport` count a name already imported (exported) from the specifier, add the missing ones to the declaration the file has for it or else after the last import (re-export), write what the project's formatter writes, and leave a region `equal` or absent, never user-owned.
- `ts.elysiaUse` puts `.use(<argument>)` on a line of its own after the last `.use` that leads the chain `export const <targetName> = new Elysia(...)...` and before its first other call, is `equal` when any `.use(<argument>)` is in the chain, and is `failed` on a missing file, variable or `new Elysia` root, or on a one-line chain that already has calls.
- `{{SCOPE}}` is rendered in the arguments a module declares for a patch (a TS `moduleSpecifier`, a dependency name) when the install is planned, and the rendered text is the region key. It is never rendered in text already in a project file.
- `package.dependencies` writes each entry where the project's formatter sorts it, so the file stays what `vp fmt` writes; a region is a value, so a different version on disk is user-owned. It is how a module that wires itself into another package (an `import` from `{{SCOPE}}/<its package>`) declares that package's dependency on it, and how a module sharing another's home adds its own dependencies to that home's `package.json`. It is refused at planning when it declares no entry, names a package twice (once `{{SCOPE}}` is rendered) or in both maps, or holds `{{SCOPE}}` in a version (only a name is rendered); at install it is `failed` on a missing file, a file that is not JSON or a map that is not an object, and an entry `--force` replaces is reported with the version it replaced.
- Every patch MUST be idempotent: applying it twice yields `applied` then `skipped`, and an identical tree.
- A patch MUST NOT perform free-text search/replace across arbitrary source.
- Scope placeholder rewriting (`{{SCOPE}}`) of file text happens at template render time on tier-1 files only — it is **not** a patch and MUST NOT run over project-owned files. Rendering a patch's declared arguments (above) is not rewriting file text.
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

**A file with recorded regions is checked region by region.** A patch rewrites a file whose tier-1 sha `bg.json` recorded, so the whole-file sha no longer matches and says nothing about a user edit. `doctor` skips the sha check for that file and reports its regions instead ([Region ownership](#region-ownership)). The conflict policy below classifies it by region too: the sha rows apply to a file without recorded regions. The sha recorded is that of the file as its owner wrote it, the owner's own patches included and no other module's, whether those run in the same call or a later one, so the owner added alone again keeps a file another module patched and replaces one nobody touched.

## Patch outcomes

A patch result is `applied`, `skipped`, or `failed` with a reason. Recorded in `bg.json` alongside the module.

**Degradation (normative):** a `failed` patch MUST NOT abort the whole install and MUST NOT be silently ignored. It is converted into a pending tier-3 intent carrying the patch's intent, target file, and failure reason. `doctor` reports it; the executor protocol of [065](./065-intentions.md) resolves it.

The intention's id is `<category>/<module-id>/patch-<type>-<file>-<first region>` in kebab case, `bg.json` records it on the failed patch as `intention`, a patch may carry an optional `intent` sentence for it, and `add` stages it as `.bg/add/NN-<slug>.md` beside `session.md` and withholds the module's `checks` until none is pending.

## Staging

- All tier-1 and tier-2 writes MUST be computed in a virtual tree before any disk write.
- `--dry-run` MUST print the full plan — files, regions, deps, env keys, pending intents — and write nothing.
- Disk application MUST be all-or-nothing: on any error mid-write, the tree is restored and `bg.json` is unchanged.

## Conflict policy

| Situation                                                        | Default                                                                                                               |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Target file missing                                              | create                                                                                                                |
| Target file identical to recorded sha                            | keep, report `skipped`                                                                                                |
| Target file without regions differs from recorded sha, `add`     | error listing every path; `--force` overwrites                                                                        |
| Target file without regions differs from recorded sha, `upgrade` | keep, report; `--force` overwrites                                                                                    |
| Target file recorded for another owner                           | error naming both owners; `--force` takes it over and reports it                                                      |
| Target file with recorded regions, edited since written, `add`   | keep, report `kept`; only the regions written are classified; `--force` overwrites a differing region, never the file |
| Region present and equal                                         | `skipped`                                                                                                             |
| Region present and differing                                     | error; `--force` overwrites                                                                                           |
| Region owned by another module                                   | error always — `--force` does not bypass                                                                              |
| Category already filled (`cardinality: one`)                     | error always — use `bg replace`                                                                                       |

`add` and `upgrade` differ on a user-modified file on purpose. `add` is a request to install a module whole: keeping the user's file would record the module as installed without that file, so it fails and names the paths. `upgrade` moves an installed project forward: it keeps the user's edit and reports it.

## Acceptance

- Adding `auth` to a project with an `api` creates `packages/auth`, registers the workspace, merges env keys, and inserts one `.use()` — without reformatting `app.ts`.
- Re-running the same `add` reports every patch `skipped` and leaves the tree byte-identical.
- Hand-editing a patched region then re-adding reports the region as user-owned and does not overwrite it.
- `bg remove auth` removes `packages/auth` and exactly the recorded regions.
- A patch made to fail (missing seam file) yields a pending intent, not a failed install.
