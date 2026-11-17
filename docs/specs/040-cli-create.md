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
2. Resolve the choices ([Choices](#choices)) and check them against the registry; an invalid set fails here, before anything is written.
3. Validate name and target (refuse a non-empty existing dir).
4. Copy embedded `templates/base`, rendering `{{SCOPE}}` / `{{DISPLAY_NAME}}` placeholders.
5. Write `bg.json` (`version: 2`) with default `@bg` registry source pinned to the running CLI version.
6. Unless no app is chosen, add the modules and items of the choices in one `bg add` call ([050](./050-cli-add.md)), without its install.
7. Optionally `git init`.
8. Optionally `bun install`, once.

## Choices

`create` asks what the project has, never which library fills a slot. Each answer names registry modules and items, and step 6 adds them through the `bg add` pipeline: they are recorded in `bg.json` like any `add`, so `doctor`, `remove` and `upgrade` cannot tell a created project from one composed by hand.

| Axis     | Flag                | Values                                                   | Asked                 |
| -------- | ------------------- | -------------------------------------------------------- | --------------------- |
| Apps     | `--apps <a,b>`      | `api`, `spa`, `ssr`, `static`                            | Always                |
| Provider | `--provider <name>` | `cloudflare`, `dockerfile`                               | When an app is chosen |
| Features | `--features <a,b>`  | `db`, `auth`, `storage`, `email`, `deploy`, `backoffice` | When an app is chosen |

What each answer names, the one table the CLI holds:

| Answer                   | Names                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| any app                  | `provider/<provider>`, `tooling/vite-plus`, `config/branding`, `dev/portless` |
| `spa`, `ssr` or `static` | `ui/shadcn`, and `web/spa`, `web/ssr` or `web/static`                         |
| `api`                    | `api/elysia`                                                                  |
| `db`                     | `db/d1`, `orm/drizzle`                                                        |
| `auth`                   | `auth/better-auth`, and the item `spa-auth` with `spa`                        |
| `storage`                | `storage/r2`                                                                  |
| `email`                  | `email/resend`                                                                |
| `deploy`                 | `deploy/cloudflare-actions`                                                   |
| `backoffice`             | the item `spa-backoffice`                                                     |

**Normative:**

- Which sets are valid is the registry's to say, never a table in the CLI: the names are checked as `bg add` would plan them in an empty project (peers, cardinality, a variant for each module, the modules each item needs), reading no template file. A combination becomes valid by changing the registry alone.
- An axis given by its flag is never asked. Under `--yes` or without a TTY, a missing axis takes its default: no app, the first provider of the table the check accepts, no feature. With no app, the project is the base alone.
- On a TTY, the provider is asked among those the check accepts with the apps chosen, and Enter takes the first. Apps and features are asked as a list of numbers or names, and Enter takes none. An answer the check refuses prints its message and asks the axis again: the apps when no provider accepts them, else the features.
- Without a TTY or under `--yes`, a refused set fails `create` with the check's message, before anything is written. `--provider` or `--features` with no app is refused.
- A failed patch or a pending intention of the add is reported as `bg add` reports it. It does not fail `create`.
- Golden ([070](./070-testing-and-release.md)) builds named answer sets, not a module list of its own: a set golden builds is one `create` produces.

## Naming (normative)

`bg create ../tmp-app`, `bg create /abs/path/my-app`, and `bg create .` MUST all produce the same shape: the package name and derived scope come from the target directory's basename. Slugifying the supplied path is a defect — it leaks the whole path into `package.json`, into `bg.json` `scope`, and from there into every workspace package the scope placeholder reaches.

## Flags (MUST)

| Flag                  | Effect                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `--yes`               | Non-interactive: take the default for every prompt                             |
| `--apps <a,b>`        | The apps ([Choices](#choices)); none by default                                |
| `--provider <name>`   | The provider; the first one the apps allow by default                          |
| `--features <a,b>`    | The features; none by default                                                  |
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
- `bg create tmp-app --apps api,spa --features email --provider dockerfile --yes --no-git --no-install` records the modules of those answers in `bg.json`.
- `bg create tmp-app --apps spa --yes` fails with the planner's message (`web/spa` needs a module in category `api`) while the registry says so, and writes nothing.
- `bg create tmp-app --features auth --yes` fails: a feature needs an app.
- `bg create /abs/path/my-app` yields scope `@my-app`, not a slugified path.
- Re-running against the same non-empty directory fails.
