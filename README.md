# Bonne Garde

Boîte à outils **shadcn-like** pour applications Cloudflare/Bun : socle vide + CLI `bg` + registry (UI + features). Pas un boilerplate à cloner — tout passe par le CLI.

Le monorepo applicatif historique est dissous dans le registry (modules, items, features) : il ne reste ici que la plateforme. Usage :

```bash
bun run bg -- create my-app --yes --no-git --registry local:./registry
cd my-app
bun run --filter @bonne-garde/cli start -- add ui/shadcn button config/branding provider/cloudflare api/elysia
```

Dans ce monorepo (développement local, avec le Bun de `package.json#packageManager`) :

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
packages/cli/          # @bonne-garde/cli (bins: bg, create-bonne-garde)
packages/schema/       # bg.json validation
packages/registry/     # load / plan / apply
templates/base/        # empty monorepo template
registry/              # source registry (ui, features, modules)
scripts/               # golden, registry build, pack, doc generators
docs/specs/            # normative specs
```

## Specs

Voir [docs/specs/README.md](./docs/specs/README.md).

## Stack du code installé par le registry

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

## Verification

`bun run verify` runs formatting/lint checks, typechecking (platform packages and scripts), the script, registry-contract and platform package tests, the migration-intentions lint and the registry build.

`bun run golden` is what runs the code the registry ships: it creates a fresh project, installs every module and item with one provider, then typechecks, tests, builds and runs `bg doctor --strict` on it (it also builds and runs the `provider/dockerfile` image when docker is available).

## Default Admin — local development only

Après `bun run db:seed` dans un projet généré avec `auth/better-auth` :

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
