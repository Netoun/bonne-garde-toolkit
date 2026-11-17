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
2. Resolve the template ([Templates](#templates)); an unknown one fails here, before anything is written.
3. Validate name and target (refuse a non-empty existing dir).
4. Copy embedded `templates/base`, rendering `{{SCOPE}}` / `{{DISPLAY_NAME}}` placeholders.
5. Write `bg.json` (`version: 2`) with default `@bg` registry source pinned to the running CLI version.
6. Unless the template is `empty`, add its modules and items in one `bg add` call ([050](./050-cli-add.md)), without its install.
7. Optionally `git init`.
8. Optionally `bun install`, once.

## Templates

A template is a named recipe: the modules and items step 6 adds. It is not a file tree. What it installs goes through the `bg add` pipeline and is recorded in `bg.json` like any `add`, so `doctor`, `remove` and `upgrade` cannot tell a project created from a template from one composed by hand.

| Template     | Installs                                                                                                                                                      |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `empty`      | Nothing: the base alone                                                                                                                                       |
| `cloudflare` | Elysia on Workers, D1 + Drizzle, Better Auth, R2, Resend, SPA + SSR + static fronts, the GitHub Actions deploy, and the SPA's `spa-auth` and `spa-backoffice` |
| `dockerfile` | One Bun container serving the Elysia API and the SPA from a single origin, with Resend; no database, no auth                                                  |

**Normative:**

- Templates ship in the CLI package and move with its version; their names address the registry of that same version.
- Every template other than `empty` MUST be a golden configuration ([070](./070-testing-and-release.md)): golden builds its configurations from the templates, so a template that does not install, typecheck, test and build fails the release.
- A failed patch or a pending intention of the template is reported as `bg add` reports it. It does not fail `create`.
- The template's choice is resolved in this order: `--template`, then `empty` under `--yes` or without a TTY, then the prompt. The prompt lists the templates by number, and Enter takes `empty`.

## Naming (normative)

`bg create ../tmp-app`, `bg create /abs/path/my-app`, and `bg create .` MUST all produce the same shape: the package name and derived scope come from the target directory's basename. Slugifying the supplied path is a defect — it leaks the whole path into `package.json`, into `bg.json` `scope`, and from there into every workspace package the scope placeholder reaches.

## Flags (MUST)

| Flag                  | Effect                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `--yes`               | Non-interactive: take the default for every prompt                             |
| `--template <name>`   | The template to apply (default `empty`)                                        |
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
- `bg create tmp-app --template cloudflare --yes --no-git --no-install` records every module and item of the template in `bg.json`.
- `bg create tmp-app --template nope` fails naming the templates, and writes nothing.
- `bg create /abs/path/my-app` yields scope `@my-app`, not a slugified path.
- Re-running against the same non-empty directory fails.
