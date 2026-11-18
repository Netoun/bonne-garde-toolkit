# 010 — Base template

## Objective

Define `templates/base`: the empty monorepo copied by `bun create bonne-garde@latest`.

## Contents (MUST)

- Root `package.json` with workspaces `apps/*`, `packages/*`
- Bun package manager pin, TypeScript strict root config, `@types/node`
- Vite+ / check tooling stubs (fmt, lint, check scripts)
- Root `dev`, `build`, `typecheck` and `test` scripts that fan out to the workspaces with `vp run -r --parallel --log labeled <task>` (each line names its workspace; `--parallel` because modules form workspace cycles, which dependency ordering refuses; `build`, `typecheck` and `test` add `--concurrency-limit 4`, since every Vitest starts its own workers, and `dev` does not, since its processes never end): Vite+'s runner reads bun and pnpm workspaces alike, skips a workspace without the task, and does not run the root's own script again
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
