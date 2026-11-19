# CLI behaviour

The commands and flags are in [COMMANDS.md](./COMMANDS.md) and `bonne-garde --help`. This page holds what they do.

The published package is `bonne-garde`: one JavaScript bundle that runs on Node ≥ 22.12 and on Bun, with `templates/base` embedded and no `Bun` global. Without the project's package manager, `create` and `add` still write the files, print one line naming the missing manager and the install to run, and exit non-zero.

## `create`

1. Resolve the target; the project name and scope come from its **basename**, never the path given (`../tmp-app`, `/abs/my-app` and `.` give the same shape).
2. Resolve the choices and check them against the registry; an invalid set fails before anything is written.
3. Refuse a non-empty existing directory.
4. Copy `templates/base`, rendering `{{SCOPE}}` and `{{DISPLAY_NAME}}`.
5. Write `bg.json` (`version: 2`) with the `@bg` registry pinned to the running CLI's version.
6. Run one `add` of the choices' modules and items, without install.
7. Optionally `git init`, then install once with the package manager the project pins.

`create` asks what the project has, never which library fills a slot:

| Axis            | Flag             | Values                                                               | Default                                       |
| --------------- | ---------------- | -------------------------------------------------------------------- | --------------------------------------------- |
| Package manager | `--pm`           | `bun`, `pnpm`                                                        | the one `create` was started from, else `bun` |
| Apps            | `--apps a,b`     | `api`, `spa`, `ssr`, `static`                                        | none                                          |
| Provider        | `--provider`     | `cloudflare`, `dockerfile`                                           | first one the check accepts                   |
| Features        | `--features a,b` | `db`, `auth`, `storage`, `email`, `deploy`, `backoffice`, `portless` | none                                          |

Each answer names registry content, held in one table in the CLI (`packages/cli/src/choices.ts`): the package manager names `pm/bun` or `pm/pnpm`; any app names `provider/<provider>`, `tooling/vite-plus`, `config/branding`; `spa`, `ssr`, `static` name `ui/shadcn` and `web/<app>`; `api` names `api/elysia`; `db` names `db/d1` and `orm/drizzle`; `auth` names `auth/better-auth` (and the item `spa-auth` with `spa`); `storage` names `storage/r2`; `email` names `email/resend`; `deploy` names `deploy/cloudflare-actions`; `backoffice` names the item `spa-backoffice`; `portless` names `dev/portless`.

- Which sets are valid is the registry's to say, never a table in the CLI: names are checked as `add` would plan them in an empty project (peers, cardinality, a variant per module, the modules each item needs). A combination becomes valid by changing the registry alone.
- A flag answers its axis, which is then not asked. Under `--yes` or with no TTY a missing axis takes its default. `--provider` or `--features` with no app is refused.
- On a TTY the questions are menus (the package manager first, then apps, provider, features; the directory when none is given); an answer the check refuses is asked again; Ctrl+C stops before anything is written, exit 130. Without a TTY on stdout, `create` prints plain lines (`created <target> with …`, then what is left to do, on stderr).
- A failed patch or a pending intention of the add is reported as `add` reports it; it does not fail `create`.
- Every prompt has an equivalent flag, and `--yes` resolves them all. A flag accepted but ignored is a defect.

## `add`

1. Load and validate `bg.json`; fail closed on an unknown schema version.
2. Load the registry sources, both catalogs.
3. Classify each name as an item or a module (`<category>/<id>`, or a bare id in any category).
4. Resolve the graph: `registryDependencies` for items, `peers` and `consumesPackages` for modules.
5. Check cardinality; a filled `one` category fails pointing at `replace`.
6. Resolve `options` from their defaults.
7. Select one variant per module by the most specific `match`.
8. Build the plan: files, regions, workspace packages, dependencies, env keys, checks, pending intents.
9. Print it; with `--dry-run`, stop there, writing no file and no `bg.json`. The outcome is JSON on stdout when stdout is not a TTY or with `--json`, and a summary on a TTY.
10. Stage tiers 1 and 2 in a virtual tree and classify every target against `files` and `regions` ([MANIFEST.md](./MANIFEST.md#conflict-policy)).
11. Apply to disk all or nothing; each failed patch becomes a pending intent.
12. Update `bg.json`.
13. Unless `--no-install`, install with the project's package manager.
14. Stage the pending intentions into `.bg/add/session.md` and print the executor entry point ([MODULES.md](./MODULES.md#tier-3-intentions)).

Steps 1–13 are deterministic: a plan with no pending intention completes with no agent and no TTY. A dependency comes from the variant and nowhere else. An installed module the call does not name, one of whose variants matches a module the call adds, is selected again and planned as a re-add (`--force` does not reach it); a collision names both modules and the command that resolves it. `--yes` is accepted and changes nothing: `add` never prompts. `--set` is refused until the key's module can be addressed.

| Case                                         | Behaviour                                                               |
| -------------------------------------------- | ----------------------------------------------------------------------- |
| Unknown name                                 | Fail with suggestions from `search`                                     |
| Missing peer, or peer outside its allow-list | Fail naming the category and the allow-list, or the incompatible module |
| Category already filled                      | Fail pointing at `replace`                                              |
| No variant matches                           | Fail listing the installed peers and the `match` keys                   |
| UI item without the `ui` module              | Fail naming it                                                          |
| Feature item without a needed module         | Fail naming every missing one and the command that installs them        |
| Collision with a user-modified file          | Fail listing the paths; `--force` overwrites                            |
| Region owned by another module               | Fail; `--force` does not bypass                                         |

## `doctor`

Compares `bg.json` with the tree, with no network. `--strict` exits non-zero on a warning, for CI; `--json` prints the report.

| Check      | Signal                                                                                                          |
| ---------- | --------------------------------------------------------------------------------------------------------------- |
| Manifest   | Schema version, module and item counts                                                                          |
| Files      | Missing, user-modified (by bytes), expected but untracked. A file with regions is checked by region, not by sha |
| Regions    | Present, missing, owned by another module, foreign edit                                                         |
| Patches    | Recorded `failed` outcomes                                                                                      |
| Intentions | Pending, applied, skipped                                                                                       |
| Peers      | A module whose peer category is now empty                                                                       |

## `remove` and `replace`

Not implemented: the CLI refuses them. The design: `remove` deletes the files whose sha still matches and exactly the recorded regions, keeps and reports files the user modified, and lists applied intention ids as manual cleanup (tier 3 is not revertible). `replace` is `remove` then `add` of the new module of that category, in one plan.
