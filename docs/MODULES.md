# Writing a module

One directory per module: `registry/modules/<category>/<id>/`. The path is the identity.

```text
registry/modules/auth/better-auth/
  module.json
  README.md              # human docs
  intent/01-wire-auth-into-api.md
  template/              # tier 1, mirrors the target tree
    packages/auth/package.json
    packages/auth/src/index.ts
```

## `module.json`

```json
{
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
  "checks": ["vp run typecheck", "vp run test"],
  "variants": [
    {
      "key": "default",
      "match": {},
      "workspace": { "name": "{{SCOPE}}/auth", "path": "packages/auth" },
      "dependencies": { "better-auth": "1.4.2" },
      "env": [{ "name": "BETTER_AUTH_SECRET", "required": true, "example": "" }],
      "copy": ["packages/auth/package.json", "packages/auth/src/index.ts"],
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

| Field              | Rules                                                                                                 |
| ------------------ | ----------------------------------------------------------------------------------------------------- |
| `id`               | Unique in its category, kebab-case                                                                    |
| `category`         | One of [`MODULE_CATEGORIES`](./CONCEPTS.md#categories)                                                |
| `version`          | Informational; the lockstep version is authoritative                                                  |
| `peers`            | Category → allow-list of module ids; an empty list means any. By category, never by capability string |
| `consumesPackages` | Workspace packages this module imports; validates the install graph                                   |
| `options`          | Consumer toggles, resolved before variant selection and recorded in `bg.json`                         |
| `checks`           | Commands that validate the added surface                                                              |
| `variants`         | Install payloads                                                                                      |

## Variants

One variant per peer combination the module supports. The most specific `match` satisfied by the installed peers wins; `{}` is the default.

- A `match` may name a category absent from `peers`: an optional peer. The variant applies only when that category is installed, and installing it later selects the variant again (`add` reports the variant left and the one taken).
- A `match` key that is not a category, or a tie between variants, is an authoring error: the contract test fails.
- `workspace`: the package to create (name and path), derived from `home` unless overridden.
- `dependencies` / `devDependencies`: exact versions, declared once, in the variant. A vendored `package.json` may carry `exports` and `scripts` but no dependency maps; the planner merges the variant's. Without one, the workspace `package.json` is generated.
- `env`: merged into the project's env example file. A key belongs to the module whose code reads it; a second module declaring it is a region conflict. An existing value is never overwritten.
- `copy` (tier 1): file paths relative to `template/`, which mirrors the target tree, so the path is the destination. No glob: a `github:` source has no listing to expand it.
- A variant selects among files at distinct paths. A file every provider ships but that differs per provider belongs to the provider module, or to one module per implementation (`db/d1`, `db/libsql`) with a `peers.provider` allow-list.
- A `template/` file is binary when its bytes are not valid UTF-8. A text file has `{{SCOPE}}` rendered; a binary one is copied byte for byte, never rendered, formatted or patched.
- A tier-1 file carrying the scope must be what the formatter writes at every scope `create` accepts. A line whose wrap depends on the scope carries `// oxfmt-ignore`; `packages/cli/src/scope-format.test.ts` fails on the first file the formatter would change.

## Checks

A project runs on bun or pnpm and its tests run on Vitest, which is Node under both. So a module's code runs on Node:

- A check is a shell command run at the project root with `node_modules/.bin` first on `PATH`, naming no package manager: `vp run <script>`, `cd <package> && vp run <script>`, or a bin.
- Tests import `vite-plus/test` and run under `vp test`. A script a module adds runs as `tsx <file>.ts`.
- No template file or command reaches for Bun (`Bun.`, `bun:`, `bunx`), except files of a variant only a Bun project installs. The contract test enforces it.

`add` does not run `checks` yet: it prints them, and withholds them while an intention is pending.

## Tier 2: patches

The catalog is closed: a new type is a platform change with its tests.

| `type`                 | Args                                                | Owned region                                    |
| ---------------------- | --------------------------------------------------- | ----------------------------------------------- |
| `jsonc.merge`          | `file`, `value`                                     | each leaf dot-path written                      |
| `env.append`           | `file`, `lines`                                     | each `KEY`                                      |
| `workspace.add`        | `name`, `path`, `dependencies?`, `devDependencies?` | `workspaces[<path>]`                            |
| `scripts.merge`        | `file`, `scripts`                                   | `scripts.<key>`                                 |
| `package.dependencies` | `file`, `dependencies?`, `devDependencies?`         | `dependencies.<name>`, `devDependencies.<name>` |
| `ts.addImport`         | `file`, `moduleSpecifier`, `namedImports`           | `imports[<specifier>]`                          |
| `ts.addNamedExport`    | `file`, `moduleSpecifier`, `exports`                | `exports[<specifier>]`                          |
| `ts.elysiaUse`         | `file`, `targetName`, `argument`                    | `elysia[<targetName>].use[<argument>]`          |

Rules:

- JSON and JSONC edits go through `jsonc-parser` (`modify` + `applyEdits`), so comments and formatting survive. TypeScript edits go through `ts-morph`, parsing the one file in memory with no tsconfig and no type checker. Never regex, never free-text search and replace.
- Every patch is idempotent: `applied`, then `skipped` with an identical tree.
- `jsonc.merge` writes an array whole as a leaf and fails a leaf under a parent that is not an object.
- `ts.addImport` / `ts.addNamedExport` add only the names missing, to the declaration the file has for the specifier, else after the last import.
- `ts.elysiaUse` puts `.use(<argument>)` on its own line after the last `.use` leading `export const <targetName> = new Elysia(...)`. It is `equal` when any `.use(<argument>)` is in the chain, and `failed` on a missing file, variable or `new Elysia` root, or on a one-line chain that already has calls.
- `package.dependencies` writes each entry where the formatter sorts it. A different version on disk is user-owned. It is how a module that imports `{{SCOPE}}/<its package>` declares the dependency on it. It is refused at planning with no entry, a name twice or in both maps, or `{{SCOPE}}` in a version.
- `{{SCOPE}}` is rendered in the arguments a module declares for a patch (the rendered text is the region key), never in text already in a project file. It is not a patch.
- A failed patch (outcome `applied`, `skipped` or `failed` with a reason, recorded in `bg.json`) becomes the pending intention `<category>/<module-id>/patch-<type>-<file>-<first region>`, staged as `.bg/add/NN-<slug>.md` beside `session.md`. An optional `intent` sentence on the patch describes it.
- All tier-1 and tier-2 writes are computed in a virtual tree first. Disk application is all or nothing: on an error the tree is restored and `bg.json` is unchanged.

## Tier 3: intentions

Module install intentions and release migrations share one format, linter and protocol. An intention states a change's meaning (goal, applicability, observable gaps, validation), never a diff. A human or supervised agent replays it; the CLI stages and records, and never rewrites application code.

| Rule        | Detail                                                                                                                                                                          |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Filename    | `NN-slug.md`; the `NN-` prefix is the execution order                                                                                                                           |
| Id          | Frontmatter `id`, without `NN-`: `<category>/<module-id>/<slug>` (install) or `vX.Y.Z/<slug>` (migration)                                                                       |
| Frontmatter | `id`, `kind` (`install` / `migration`), `domain` (a category), `classification` (`informational` / `migration` / `breaking-manual`), optional `requires` (ids strictly earlier) |

Sections, all required:

- **Goal / Why**, the end state and its rationale.
- **Applies When / Do Not Apply When**: observable conditions. A prior stack being migrated away from is an apply signal.
- **Observable Gaps**: greppable and binary.
- **Out of Scope**.
- **Reference Paths**: each `copy` (take verbatim) or `adapt` (diff first, replay the meaning). An `adapt` path is one repo-relative file, no glob.
- **Validation**: commands to run after applying; a module's `checks` land here.
- **Record Result**.

Executor protocol, identical for install and upgrade:

1. Read the staged checklist: `.bg/add/session.md` (install) or `.bg/upgrade/session.md`.
2. Propose apply or skip per intention, citing observable signals, and wait for confirmation before any edit or record.
3. One confirmed intention at a time; diff the Reference Paths, never retype from memory.
4. Run its Validation and the project's `typecheck` / `test` / `check`.
5. `bonne-garde record <id>` (or `--skip "<reason>"`), one commit per intention. Nothing is recorded before Validation passes.
6. On `breaking-manual`, a failed validation or an unconfirmed decision, write `blocked.md` beside the session file and record nothing.

`.bg/` is the gitignored, disposable scratch root. `bg.json` is the only durable record. `bonne-garde intentions lint` (in `bun run verify`) checks filenames and unique prefixes, frontmatter, id against path, `requires`, required sections, Reference Paths, and that a release README lists its ids. The linter and parser live in `packages/schema` and `packages/cli/src/intentions`.

## Tests

- Contract tests (`packages/registry/src/module-contract.test.ts`) validate every `module.json`, every `registry.json` against the shadcn schema, peers order and `match` ambiguity.
- Each patch type has an apply-then-skip idempotency test on a real fixture.
- `registry/` and `templates/` are source material, not workspaces: their imports resolve only in an installed project. `bun run golden` is what typechecks, tests and builds them. See [TESTING.md](./TESTING.md).
