# 010 — Base template

## Objective

Define `templates/base`: the empty monorepo copied by `bun create bonne-garde@latest`.

## Contents (MUST)

- Root `package.json` with workspaces `apps/*`, `packages/*`
- Bun package manager pin, TypeScript strict root config
- Vite+ / check tooling stubs (fmt, lint, check scripts)
- Husky prepare hook stub (optional if hooks dir empty)
- `.gitignore` ignoring the `.bg/` scratch root ([065](./065-intentions.md)), `README.md`, minimal `AGENTS.md`
- Minimal `bg.json` (`version: 2`, scope placeholder `@acme`, `platform.version` placeholder, empty `modules` / `items` / `files` / `regions`) — see [020](./020-project-manifest.md)
- Placeholder keepers so empty dirs survive packaging (`apps/.gitkeep`, `packages/.gitkeep`)

## MUST NOT include

- Any app under `apps/` (api, spa, ssr, static)
- Any package under `packages/` (ui, emails, config)
- Cloudflare / Elysia / React Router / Better Auth / Drizzle dependencies
- Seed data, env secrets, or product branding beyond placeholders
- Any leftover from the legacy init flow (`.acme-init.json` and friends)

## Packaging

- Template MUST be embedded in the published CLI package and versioned with it.
- Primary create path MUST NOT clone a mutable GitHub branch.

## Acceptance

- After copy + `bun install`, `bun run typecheck` and `bun run test` succeed (no-op or empty workspace ok).
- Directory listing shows no feature source files.
