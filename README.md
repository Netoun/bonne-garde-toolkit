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
bun install
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

| Layer    | Tech                        |
| -------- | --------------------------- |
| Runtime  | Bun                         |
| API      | Elysia (Cloudflare Workers) |
| Database | Drizzle + D1                |
| Auth     | Better-auth                 |
| Fronts   | React Router v7 + shadcn/ui |

## Legacy app (encore présente)

```bash
bun install
bun run init
bun run brand
bun run dev
```

Default admin after seed: `admin@example.local` / `password123`.

## Docs

- [Specs](./docs/specs/README.md)
- [Architecture](./docs/ARCHITECTURE.md)
- [Commands](./docs/COMMANDS.md)
- [Agent instructions](./AGENTS.md)
