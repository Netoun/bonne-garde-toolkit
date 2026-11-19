<p align="center"><img src="assets/logo/logo.svg" alt="Bonne Garde" width="128"></p>

<p align="center">
  <a href="https://github.com/Netoun/bonne-garde-toolkit/actions/workflows/ci.yml"><img src="https://img.shields.io/github/actions/workflow/status/Netoun/bonne-garde-toolkit/ci.yml?branch=main&label=CI" alt="CI"></a>
  <a href="https://www.npmjs.com/package/bonne-garde"><img src="https://img.shields.io/npm/v/bonne-garde?color=93bee1" alt="npm"></a>
  <a href="https://www.npmjs.com/package/bonne-garde"><img src="https://img.shields.io/node/v/bonne-garde?color=93bee1" alt="Node"></a>
  <img src="https://img.shields.io/badge/projects-Bun%20%7C%20pnpm-93bee1" alt="Generated projects install with Bun or pnpm">
  <a href="./LICENSE"><img src="https://img.shields.io/github/license/Netoun/bonne-garde-toolkit?color=93bee1" alt="MIT license"></a>
</p>

# Bonne Garde

A shadcn-style toolkit for full-stack TypeScript apps. Not a boilerplate to clone: you start from an empty monorepo and the `bonne-garde` CLI copies in the pieces you pick. The code lands in your project and is yours; nothing depends on Bonne Garde at runtime.

Three parts, one repository, one version:

- **the base template**: an empty monorepo with tooling and no app;
- **the CLI** `bonne-garde`: creates a project, then adds to it;
- **the registry**: UI components, feature blocks and full-stack modules.

## Quick start

```bash
bunx bonne-garde create my-app   # or npx, pnpm dlx, yarn dlx
cd my-app
bunx bonne-garde add ui/shadcn button
```

`create` asks for the package manager, the apps, the provider and the features. With `--yes` it creates the empty base. The CLI runs on Node ≥ 22.12 or Bun; a project installs with Bun or pnpm.

## CLI

| Command                             | What it does                                                                                         |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `bonne-garde create [dir]`          | Creates a project. `--pm`, `--apps`, `--provider`, `--features`, `--yes`, `--no-git`, `--no-install` |
| `bonne-garde add <name...>`         | Adds items or modules (`button`, `api/elysia`). `--dry-run` shows the plan and writes nothing        |
| `bonne-garde list`                  | Lists the registry. `--items`, `--category <category>`                                               |
| `bonne-garde search <query>`        | Searches the registry                                                                                |
| `bonne-garde view <item>`           | Shows one item                                                                                       |
| `bonne-garde doctor`                | Compares the project with its `bg.json`. `--strict`, `--json`                                        |
| `bonne-garde record <intention-id>` | Records an intention as applied, or skipped with `--skip "<reason>"`                                 |

`bonne-garde --help` prints every flag. A registry source is `local:<path>` or `github:owner/repo[@ref]`.

## Registry

| Category   | Modules                    | Brings                                              |
| ---------- | -------------------------- | --------------------------------------------------- |
| `pm`       | `bun`, `pnpm`              | The package manager pin and its CI setup            |
| `provider` | `cloudflare`, `dockerfile` | Cloudflare Workers, or one Node container           |
| `api`      | `elysia`                   | The Elysia API and the Eden types the fronts import |
| `db`       | `d1`                       | The D1 (SQLite) binding                             |
| `orm`      | `drizzle`                  | The Drizzle client, schema and migrations           |
| `auth`     | `better-auth`              | Sessions, email verification, organizations         |
| `storage`  | `r2`                       | Media uploads over R2                               |
| `email`    | `resend`                   | Transactional email with React templates            |
| `web`      | `spa`, `ssr`, `static`     | React Router v8 fronts                              |
| `ui`       | `shadcn`                   | The package that hosts the UI items                 |
| `config`   | `branding`                 | Branding constants, web manifest, favicons          |
| `tooling`  | `vite-plus`                | Lint, format and the pre-commit check               |
| `deploy`   | `cloudflare-actions`       | A GitHub Actions deploy workflow                    |
| `dev`      | `portless`                 | Named local HTTPS URLs                              |

Plus about thirty UI items (`button`, `dialog`, `sidebar`…) and two feature blocks (`spa-auth`, `spa-backoffice`). A module refuses to install when a module it needs is missing, and names it.

## Repository layout

```text
packages/cli        # the bonne-garde CLI
packages/registry   # load the registry, plan an install, apply it
packages/schema     # validation of bg.json and module.json
registry/ui         # UI items (shadcn schema)
registry/features   # feature blocks
registry/modules    # <category>/<id>: module.json + template/
templates/base      # the empty monorepo `create` copies
migrations          # upgrade intentions, one folder per release
scripts             # golden, registry build, CLI pack, doc generators
docs                # concepts, guides, ADRs
```

## Develop

Needs [Bun](https://bun.sh) at the version `package.json#packageManager` pins. `golden` also needs npm and Node ≥ 22.12.

```bash
bun install --frozen-lockfile
bun run bonne-garde -- list --source local:./registry
bun run bonne-garde -- create ../my-app --yes --no-git --registry local:./registry
```

In that project, run this checkout's CLI with `bun <path to this repo>/packages/cli/src/bin.ts add <name...>`.

| Script                   | What it does                                                                                       |
| ------------------------ | -------------------------------------------------------------------------------------------------- |
| `bun run verify`         | The CI gate: check, knip, typecheck, test, intentions lint, registry build                         |
| `bun run golden`         | Builds fresh projects with every module and item, then typechecks, tests and builds them (minutes) |
| `bun run check`          | Format and lint (Vite+)                                                                            |
| `bun run typecheck`      | Typechecks the packages and the scripts                                                            |
| `bun run test`           | Tests the packages, the scripts and the modules that need no install                               |
| `bun run registry:build` | Flattens the registry into `dist/r`                                                                |
| `bun run pack:cli`       | Bundles the npm package into `dist/npm/bonne-garde`                                                |
| `bun run gen:playground` | Generates a sample project in `./playground` (gitignored)                                          |

Every script: [docs/COMMANDS.md](./docs/COMMANDS.md). Most module code imports packages that exist only once installed in a project, so `bun run test` skips it: `golden` is where it is typechecked, tested and built.

## Contributing

1. Branch from `main`, one change per pull request.
2. Write the failing test first, then the code ([docs/TESTING.md](./docs/TESTING.md)).
3. Run `bun run verify`, and `bun run golden` when `registry/` or `templates/` changed.
4. Commit in Conventional Commits with a scope: `fix(cli): …`, `feat(registry): …`. The pre-commit hook checks the staged files.

Use `bun` and `bunx` only. Never edit a generated file by hand: regenerate `docs/COMMANDS.md` with `bun run gen:commands` and the generated block of `docs/ARCHITECTURE.md` with `bun run gen:architecture`. The full rules are in [AGENTS.md](./AGENTS.md) and [docs/RULES.md](./docs/RULES.md); the [code of conduct](./CODE_OF_CONDUCT.md) applies.

## Release

The CLI, the template, the registry and the migrations share one version. Pushing a tag `vX.Y.Z` publishes `bonne-garde` to npm through `.github/workflows/release.yml`. Changes: [CHANGELOG.md](./CHANGELOG.md).

## Docs

- [Concepts](./docs/CONCEPTS.md) · [Modules](./docs/MODULES.md) · [Manifest](./docs/MANIFEST.md) · [CLI](./docs/CLI.md) · [Release](./docs/RELEASE.md) · [ADRs](./docs/adr)
- [Architecture](./docs/ARCHITECTURE.md) · [Commands](./docs/COMMANDS.md) · [Testing](./docs/TESTING.md) · [Rules](./docs/RULES.md)
- [Design](./docs/DESIGN.md) · [Environment](./docs/ENVIRONMENT.md) · [Agent instructions](./AGENTS.md)

## License

[MIT](./LICENSE)
