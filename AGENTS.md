# AGENTS.md

> Canonical instructions for AI coding agents. **Single source of truth.**
>
> | Tool        | How this file is loaded                              |
> | ----------- | ---------------------------------------------------- |
> | Codex       | Native (`AGENTS.md`)                                 |
> | OpenCode    | Native (`AGENTS.md`; preferred over `CLAUDE.md`)     |
> | Cursor      | Native (`AGENTS.md`) + thin `.cursor/rules/` pointer |
> | Claude Code | Via [`CLAUDE.md`](./CLAUDE.md) import (`@AGENTS.md`) |
>
> Do **not** duplicate these rules into tool-specific files. Edit this file only.
> Deep detail lives in `docs/` — load on demand (see [Deep docs](#deep-docs-load-on-demand)).

---

## Project overview

**Platform direction:** Bonne Garde is becoming a shadcn-inspired toolkit — empty base template (`templates/base`) + CLI (`packages/cli`, bin `bg`) + open registry (`registry/`) for UI and full-stack modules. Normative specs live in [`docs/specs/`](./docs/specs/README.md).

**Legacy app (still in-tree during migration):** Bun monorepo for Cloudflare — Elysia API (Workers) + Drizzle/D1 + Better-auth + React Router v8 (SPA / SSR / static) + shadcn/ui + R2 + Resend. Toolchain: Vite+.

| Layer                       | Choice                                                                               |
| --------------------------- | ------------------------------------------------------------------------------------ |
| Runtime / Package manager   | Bun + workspaces                                                                     |
| Language                    | TypeScript strict everywhere                                                         |
| API                         | Elysia (Cloudflare Workers, AOT disabled)                                            |
| Auth                        | Better-auth (email/password, sessions, email verification)                           |
| ORM / DB                    | Drizzle — SQLite dialect / Cloudflare D1                                             |
| Storage / Email             | Cloudflare R2 / Resend + React-Email                                                 |
| Shared API types            | Eden Treaty (inferred from Elysia — no manual schema)                                |
| Fronts                      | React Router v8 + shadcn/ui + Tailwind + Zustand — Pages (SPA/static), Workers (SSR) |
| Toolchain                   | Vite+ — Vite, Vitest, Oxlint, Oxfmt; keep the unified configuration                  |
| Shared UI / Emails / Config | `packages/ui` / `packages/emails` / `packages/config`                                |

### Key decisions

| Decision                      | Why                                                                |
| ----------------------------- | ------------------------------------------------------------------ |
| D1 (SQLite)                   | Free, CF-integrated, portable SQLite                               |
| Eden Treaty                   | No shared package to maintain                                      |
| `new Elysia({ aot: false })`  | Conservative portable execution; retain the starter's non-AOT mode |
| Separate `tsconfig.test.json` | `@cloudflare/workers-types` vs `bun-types` clash                   |
| Platform agnosticism          | Never use CF proprietary APIs outside bindings `DB` / `BUCKET`     |

---

## Structure

```
acme/
├── apps/api
├── apps/spa
├── apps/ssr
├── apps/static
├── packages/config
├── packages/emails
├── packages/ui
├── docs/
└── scripts/
```

---

## Setup & commands

Always `bun` / `bunx` — never `npm` / `yarn` / `pnpm` / `npx` / `node`.
If a script exists in a `package.json`, use it — never reinvent.
Full list → [`docs/COMMANDS.md`](./docs/COMMANDS.md) (`bun run gen:commands`).

```bash
bun install
bun run bg -- list --source local:./registry
bun run bg -- create ../tmp-app --yes --no-git --no-install --registry local:./registry
bun run registry:build                    # flatten registry → dist/r
bun run pack:cli                          # dist/npm/create-bonne-garde
bun run publish:cli:dry                   # npm tarball dry-run
bun run publish:cli                       # publish create-bonne-garde to npm
bun run gen:playground                    # smoke consumer in ./playground
bun run init                              # legacy: selection, branding, env, migrations, seed
bun run brand                             # re-apply product identity / npm scope
bun run gen:branding                      # regenerate branding.generated.ts from branding.json
bun run dev                               # all apps in parallel
bun run typecheck && bun run test         # full verification
bun run check                             # vp check (fmt + lint via Vite+)
bun run verify                            # check + typecheck + all tests + all builds (CI gate)
bun run golden                            # fresh project: create → add modules + items → install → typecheck → test → build → doctor --strict → check → each module's checks (needs npm)

bun run --filter @acme/api dev
bun run --filter @acme/spa dev
bun run --filter @acme/ssr dev
bun run --filter @acme/static dev

# From apps/api/
bun run db:generate
bun run db:migrate:local
bun run db:studio
bun run db:seed
bun run auth:secret
```

---

## Non-negotiables

### Do

- **Read before writing**: this file → task/spec → existing code (`git show main:<path>` when comparing legacy)
- **Strict TDD**: red → green → refactor ([`docs/TESTING.md`](./docs/TESTING.md))
- **Eden Treaty** for all front → API calls — never raw `fetch`
- **shadcn via CLI**: `bunx shadcn@latest add <component>` — never copy by hand
- **Front = composition**: shared UI primitives, `ReactNode` slots and compound components; conventions → [`docs/RULES.md`](./docs/RULES.md#composition-first)
- **Kebab-case** for component filenames (`user-card.tsx`)
- **One task = one scope** — no drive-by refactors

### Don't

- `any` — use `unknown` + type guard
- `as` to bypass an Eden type — fix the API contract at the source
- `npm` / `yarn` / `pnpm` / `npx` / `node` — `bun` / `bunx` only
- Mock Drizzle, mock `fetch`, snapshot tests
- CF proprietary APIs outside `DB` / `BUCKET`
- Skip phases defined in the spec/issue
- `--no-verify`, `reset --hard`, `push --force` without explicit request

### Clean code filter (before and after each write)

- **Algo**: simplest approach that works?
- **Archi**: right place? separation of concerns?
- **Naming**: precise and unambiguous?
- **Volume**: every line earns its place?
- **Clarity**: simple and explicit > clever and implicit

If a choice is questionable → ask **before** implementing.

---

## Verification checklist

Before considering a task done:

- [ ] `bun run typecheck` passes
- [ ] `bun run test` passes
- [ ] `bun run check` passes
- [ ] `bun run build` passes for affected apps
- [ ] No `any`, no `as` Eden
- [ ] Eden types up to date if API changed
- [ ] New env vars → corresponding `.example` file(s)
- [ ] No files outside scope modified

---

## Deep docs (load on demand)

Do **not** preload everything. Open only what the current task needs:

| Need                                              | File                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Detailed clean-code / types / product conventions | [`docs/RULES.md`](./docs/RULES.md)                                                                                     |
| Test patterns per app                             | [`docs/TESTING.md`](./docs/TESTING.md)                                                                                 |
| All scripts                                       | [`docs/COMMANDS.md`](./docs/COMMANDS.md)                                                                               |
| System architecture                               | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)                                                                       |
| Design system                                     | [`docs/DESIGN.md`](./docs/DESIGN.md)                                                                                   |
| Environment variables                             | [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md)                                                                         |
| How agent files are wired across tools            | [`docs/AGENTING.md`](./docs/AGENTING.md)                                                                               |
| Elysia routes, validation, plugins, Eden          | [Official Elysia skill](./.claude/skills/elysiajs/SKILL.md) — follow repo conventions when its generic examples differ |
