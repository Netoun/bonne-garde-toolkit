# Bonne Garde

Boîte à outils **shadcn-like** pour applications Cloudflare/Bun : socle vide + CLI `bg` + registry (UI + features). Pas un boilerplate à cloner — tout passe par le CLI.

Ce dépôt contient encore le monorepo applicatif historique (`apps/api`, `apps/spa`, …) pendant la migration vers des items de registry. La cible produit est :

```bash
bun run bg -- create my-app --yes --no-git --registry local:./registry
cd my-app
bun run --filter @bonne-garde/cli start -- add api-elysia button config
```

Dans ce monorepo (développement local) :

```bash
bun install --frozen-lockfile
bun run bg -- list --source local:./registry
bun run registry:build
bun run pack:cli         # → dist/npm/create-bonne-garde
bun run publish:cli:dry  # tarball dry-run
bun run publish:cli      # bun publish (needs npm auth)
bun run gen:playground   # → ./playground (gitignored)
```

### Publish CLI (npm)

The consumer package is **`create-bonne-garde`** (supports `bun create bonne-garde@latest`).

```bash
bun run pack:cli
bun publish --cwd dist/npm/create-bonne-garde
```

Bins: `create-bonne-garde`, `bg`. Templates are embedded; default registry when not in this monorepo is `github:Netoun/bonne-garde-toolkit`.

## Structure plateforme

```
apps/cli/              # @bonne-garde/cli (bins: bg, create-bonne-garde)
packages/schema/       # bg.json validation
packages/registry/     # load / plan / apply
templates/base/        # empty monorepo template
registry/              # source registry (ui, apps, lib, features, tooling)
docs/specs/            # normative specs
```

## Specs

Voir [docs/specs/README.md](./docs/specs/README.md).

## Stack applicative (items / legacy apps)

Toolchain: **Vite+** (Vite, Vitest, Oxlint, Oxfmt).

| Layer    | Tech                                                |
| -------- | --------------------------------------------------- |
| Runtime  | Bun                                                 |
| API      | Elysia (Cloudflare Workers)                         |
| Database | Drizzle + D1 (SQLite)                               |
| Auth     | Better-auth                                         |
| SPA      | React Router v8 + shadcn/ui — Cloudflare Pages      |
| SSR      | React Router v8 — Cloudflare Workers                |
| Static   | React Router v8 (SPA by default) — Cloudflare Pages |
| Storage  | Cloudflare R2                                       |
| Email    | Resend + React-Email                                |

## Legacy app (encore présente)

```bash
bun install --frozen-lockfile
bun run init
bun run brand   # rejouable — identité produit + scope npm
bun run dev
```

Use the Bun version declared in `package.json#packageManager`. The init wizard keeps workspace dependencies automatically; preview removals with `bun run init -- --dry-run`.

## Verification

`bun run verify` runs formatting/lint checks, typechecking (including scripts and API tests), all tests, the migration-intentions lint, the registry build, and all app builds.

`bun run test` includes script tests, platform package tests, real SQLite API tests, package tests, and frontend tests through Vite+ (Vitest + RTL + MSW).

## Default Admin — local development only

Après seed :

- Email: `admin@example.local`
- Password: `password123`

Never seed these demo credentials in production. Configure Cloudflare resources and secrets before enabling deployment; see [Environment](./docs/ENVIRONMENT.md).

## Docs

- [Specs](./docs/specs/README.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Commands](./docs/COMMANDS.md)
- [Design](./docs/DESIGN.md)
- [Environment](./docs/ENVIRONMENT.md)
- [Rules](./docs/RULES.md)
- [Testing](./docs/TESTING.md)
- [Agent instructions](./AGENTS.md)
