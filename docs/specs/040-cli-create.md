# 040 — CLI create

## Objective

Define greenfield project creation.

## Public command

```bash
bun create bonne-garde@latest my-app [flags]
# workspace / local:
bun run --filter @bonne-garde/cli start -- create my-app [flags]
# or:
bunx bg create my-app [flags]
```

Package name during monorepo development: `@bonne-garde/cli` with bins `bg` and `create-bonne-garde`.

## Steps (MUST)

1. Resolve the target directory; derive the project name from its **basename**, never from the path given.
2. Validate name and target (refuse a non-empty existing dir).
3. Copy embedded `templates/base`, rendering `{{SCOPE}}` / `{{DISPLAY_NAME}}` placeholders.
4. Write `bg.json` (`version: 2`) with default `@bg` registry source pinned to the running CLI version.
5. Optionally `git init`.
6. Optionally `bun install`.

## Naming (normative)

`bg create ../tmp-app`, `bg create /abs/path/my-app`, and `bg create .` MUST all produce the same shape: the package name and derived scope come from the target directory's basename. Slugifying the supplied path is a defect — it leaks the whole path into `package.json`, into `bg.json` `scope`, and from there into every workspace package the scope placeholder reaches.

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

- `bg create tmp-app --yes --no-git --no-install` creates a valid empty tree with a `version: 2` `bg.json`.
- `bg create /abs/path/my-app` yields scope `@my-app`, not a slugified path.
- Re-running against the same non-empty directory fails.
