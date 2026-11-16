# 040 — CLI create

## Objective

Define greenfield project creation.

## Public command

```bash
bunx bonne-garde create my-app [flags]
# any runner: npx bonne-garde create ..., pnpm dlx bonne-garde create ..., yarn dlx bonne-garde create ...
# workspace / local:
bun run --filter @bonne-garde/cli start -- create my-app [flags]
```

Package name during monorepo development: `@bonne-garde/cli` with the bin `bonne-garde`. The published package is `bonne-garde`: JavaScript that runs on Node ≥ 22.12 and on Bun. The project it creates is a Bun monorepo, so `create` and `add` need Bun to run `bun install`: without it they still write the files, print one line saying the project needs Bun (https://bun.sh) and to run `bun install` once it is installed, and exit non-zero.

## Steps (MUST)

1. Resolve the target directory; derive the project name from its **basename**, never from the path given.
2. Validate name and target (refuse a non-empty existing dir).
3. Copy embedded `templates/base`, rendering `{{SCOPE}}` / `{{DISPLAY_NAME}}` placeholders.
4. Write `bg.json` (`version: 2`) with default `@bg` registry source pinned to the running CLI version.
5. Optionally `git init`.
6. Optionally `bun install`.

## Naming (normative)

`bonne-garde create ../tmp-app`, `bonne-garde create /abs/path/my-app`, and `bonne-garde create .` MUST all produce the same shape: the package name and derived scope come from the target directory's basename. Slugifying the supplied path is a defect — it leaks the whole path into `package.json`, into `bg.json` `scope`, and from there into every workspace package the scope placeholder reaches.

## Flags (MUST)

| Flag                  | Effect                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `--yes`               | Non-interactive: take the default for every prompt                             |
| `--no-install`        | Skip `bun install`                                                             |
| `--no-git`            | Skip git init                                                                  |
| `--scope <scope>`     | npm scope, at most 64 characters (default derived from the directory basename) |
| `--registry <source>` | Override the default `@bg` registry source                                     |

## Normative

- Template MUST be bundled with the CLI package.
- MUST NOT use `install.sh` or clone `main` as the primary path.
- Every interactive prompt MUST have an equivalent flag, and `--yes` MUST resolve all of them. A flag accepted but ignored is a defect, not a stub.

## Acceptance

- `bonne-garde create tmp-app --yes --no-git --no-install` creates a valid empty tree with a `version: 2` `bg.json`.
- `bonne-garde create /abs/path/my-app` yields scope `@my-app`, not a slugified path.
- Re-running against the same non-empty directory fails.
