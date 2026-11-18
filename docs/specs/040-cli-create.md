# 040 — CLI create

## Objective

Define greenfield project creation.

## Public command

```bash
bun create bonne-garde@latest my-app [flags]
npm create bonne-garde@latest my-app -- [flags]
pnpm create bonne-garde my-app [flags]
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
6. Add the modules and items of the choices in one `bg add` call ([050](./050-cli-add.md)), without its install: the package manager's module at least.
7. Optionally `git init`.
8. Optionally install, once, with the package manager `package.json` pins (`packageManager`, its `pm` module's).

## Choices

`create` asks what the project has, never which library fills a slot. Each answer names registry modules and items, and step 6 adds them through the `bg add` pipeline: they are recorded in `bg.json` like any `add`, so `doctor`, `remove` and `upgrade` cannot tell a created project from one composed by hand.

| Axis            | Flag                | Values                                                   | Asked                 |
| --------------- | ------------------- | -------------------------------------------------------- | --------------------- |
| Package manager | `--pm <name>`       | `bun`, `pnpm`                                            | Always, first         |
| Apps            | `--apps <a,b>`      | `api`, `spa`, `ssr`, `static`                            | Always                |
| Provider        | `--provider <name>` | `cloudflare`, `dockerfile`                               | When an app is chosen |
| Features        | `--features <a,b>`  | `db`, `auth`, `storage`, `email`, `deploy`, `backoffice` | When an app is chosen |

What each answer names, the one table the CLI holds:

| Answer                   | Names                                                                         |
| ------------------------ | ----------------------------------------------------------------------------- |
| the package manager      | `pm/bun` or `pm/pnpm`, in every project                                       |
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
- An axis given by its flag is never asked. Under `--yes` or without a TTY, a missing axis takes its default: the package manager `create` was started from (`npm_config_user_agent`: `bun create`, `pnpm create`), bun when it is neither; no app; the first provider of the table the check accepts; no feature. With no app, the project is the base and its package manager's module, so `create` reads the registry even then.
- The package manager is asked first, its default first in the list, so the providers offered are those the registry accepts with it.
- On a TTY, the questions are menus: arrows move, space picks, Enter confirms. The directory is asked when none is given, `my-app` by default. The package manager and the provider are single choices, the default first; the provider is asked among those the check accepts with the apps chosen. Apps and features are multiple choices, and none is a valid answer. An answer the check refuses prints its message and asks the axis again: the apps when no provider accepts them, else the features. Ctrl+C stops before anything is written, exit 130.
- What a person sees on a TTY is a view, not a contract: the logo, a spinner over the registry read, the copy and the install (whose output is shown only if it fails), the intentions to hand to an agent, and the next steps. Without a TTY on stdout, `create` prints the plain lines a script or an agent reads: `created <target> with …`, then what the add left to do, on stderr.
- Without a TTY or under `--yes`, a refused set fails `create` with the check's message, before anything is written. `--provider` or `--features` with no app is refused.
- A failed patch or a pending intention of the add is reported as `bg add` reports it. It does not fail `create`.
- Golden ([070](./070-testing-and-release.md)) builds named answer sets, not a module list of its own: a set golden builds is one `create` produces.

## Naming (normative)

`bg create ../tmp-app`, `bg create /abs/path/my-app`, and `bg create .` MUST all produce the same shape: the package name and derived scope come from the target directory's basename. Slugifying the supplied path is a defect — it leaks the whole path into `package.json`, into `bg.json` `scope`, and from there into every workspace package the scope placeholder reaches.

## Flags (MUST)

| Flag                  | Effect                                                                         |
| --------------------- | ------------------------------------------------------------------------------ |
| `--yes`               | Non-interactive: take the default for every prompt                             |
| `--pm <name>`         | The package manager; the one `create` was started from by default, else bun    |
| `--apps <a,b>`        | The apps ([Choices](#choices)); none by default                                |
| `--provider <name>`   | The provider; the first one the apps allow by default                          |
| `--features <a,b>`    | The features; none by default                                                  |
| `--no-install`        | Skip the install                                                               |
| `--no-git`            | Skip git init                                                                  |
| `--scope <scope>`     | npm scope, at most 64 characters (default derived from the directory basename) |
| `--registry <source>` | Override the default `@bg` registry source                                     |

## Normative

- Template MUST be bundled with the CLI package.
- The CLI MUST run on Node (≥ 22.20) as on Bun: what it runs at install is JavaScript, and it uses `node:` APIs, never a `Bun` global.
- MUST NOT use `install.sh` or clone `main` as the primary path.
- Every interactive prompt MUST have an equivalent flag, and `--yes` MUST resolve all of them. A flag accepted but ignored is a defect, not a stub.

## Acceptance

- `bg create tmp-app --yes --no-git --no-install` creates a valid tree with a `version: 2` `bg.json` that records the package manager's module alone.
- `bg create tmp-app --pm pnpm --apps api,spa --yes` installs with pnpm, and nothing it runs needs Bun.
- `bg create tmp-app --pm pnpm --apps api,spa --provider dockerfile --yes` makes a project whose image installs with pnpm and runs the API on Node.
- `bg create tmp-app --apps api,spa --features email --provider dockerfile --yes --no-git --no-install` records the modules of those answers in `bg.json`.
- `bg create tmp-app --apps spa --yes` creates a SPA with no API: no Eden client, no API variable. With `--provider dockerfile` its container serves the SPA alone.
- `bg create tmp-app --apps ssr --provider dockerfile --yes` fails with the planner's message (`web/ssr` accepts only `cloudflare`), and writes nothing.
- `bg create tmp-app --features auth --yes` fails: a feature needs an app.
- `bg create /abs/path/my-app` yields scope `@my-app`, not a slugified path.
- Re-running against the same non-empty directory fails.
