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

Bonne Garde is a shadcn-inspired toolkit: an empty base template, a CLI (`bonne-garde`) that installs registry content into it, and the registry of UI items, feature items and full-stack modules. Normative specs live in [`docs/specs/`](./docs/specs/README.md). The legacy monorepo (`apps/*`, `packages/{ui,emails,config,api-runtime}`) was dissolved into the registry and is no longer in-tree; [`docs/plans/2026-10-sync/09-dissolution.md`](./docs/plans/2026-10-sync/09-dissolution.md) records where each piece went.

| Layer                     | Choice                                                                                                          |
| ------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Runtime / Package manager | Bun + workspaces                                                                                                |
| Language                  | TypeScript strict everywhere                                                                                    |
| CLI                       | `packages/cli` (bin `bonne-garde`) over `packages/registry` (load, plan, apply) and `packages/schema`           |
| Registry                  | `registry/ui` and `registry/features` (items), `registry/modules/<category>/<id>` (`module.json` + `template/`) |
| Base template             | `templates/base`: the empty monorepo `bonne-garde create` copies                                                |
| Proof                     | `bun run golden`: one fresh project, every module and item installed, then typecheck, test, build, doctor       |
| Toolchain                 | Vite+ — Vite, Vitest, Oxlint, Oxfmt; keep the unified configuration                                             |

What `bonne-garde add` writes into a project is Elysia on Workers (AOT disabled), Drizzle/D1, Better-auth, R2, Resend, Eden Treaty, and React Router v8 + shadcn/ui + Tailwind + Zustand fronts (Pages for SPA/static, Workers for SSR). Its source is `registry/modules/*/*/template/**`, `registry/features` and `registry/ui`, and the rules below hold for it.

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
bonne-garde-toolkit/
├── packages/cli        # bonne-garde
├── packages/registry   # load / plan / apply
├── packages/schema     # bg.json and module.json validation
├── registry/           # ui/, features/, modules/<category>/<id>
├── templates/base      # empty monorepo template
├── scripts/            # golden, registry build, pack, doc generators
├── docs/               # specs/ (normative), plans/ (history)
└── migrations/         # per-release upgrade intentions
```

---

## Setup & commands

Always `bun` / `bunx` — never `npm` / `yarn` / `pnpm` / `npx` / `node`. The one exception: `scripts/pack-cli.test.ts` and golden run the packed CLI with `node`, the runtime it targets.
If a script exists in a `package.json`, use it — never reinvent.
Full list → [`docs/COMMANDS.md`](./docs/COMMANDS.md) (`bun run gen:commands`).

```bash
bun install
bun run bonne-garde -- list --source local:./registry
bun run bonne-garde -- create ../tmp-app --yes --no-git --no-install --registry local:./registry
bun run registry:build                    # flatten registry → dist/r
bun run pack:cli                          # dist/npm/bonne-garde
bun run publish:cli:dry                   # npm tarball dry-run
git push origin vX.Y.Z                    # release: .github/workflows/release.yml publishes bonne-garde to npm
bun run gen:playground                    # smoke consumer in ./playground
bun run typecheck && bun run test         # platform packages + scripts
bun run check                             # vp check (fmt + lint via Vite+)
bun run verify                            # check + knip + typecheck + test + intentions lint + registry build (CI gate)
bun run golden                            # fresh project: create → add modules + items → install → typecheck → test → build → doctor --strict → check → each module's checks → dockerfile configuration: docker build + run (skipped without docker, a failure when GOLDEN_REQUIRE_DOCKER is set) (needs npm, and node ≥ 22.12 on PATH: it runs the packed CLI)
```

Most module and feature code imports packages that exist only after install, so `bun run test` skips it: golden is where it is typechecked, tested and built.

---

## Non-negotiables

### Do

- **Read before writing**: this file → task/spec → existing code
- **Strict TDD**: red → green → refactor ([`docs/TESTING.md`](./docs/TESTING.md))
- **Eden Treaty** for all front → API calls — never raw `fetch`
- **shadcn via CLI**: `bunx shadcn@latest add <component>` — never copy by hand
- **Front = composition**: shared UI primitives, `ReactNode` slots and compound components; conventions → [`docs/RULES.md`](./docs/RULES.md#composition-first)
- **Kebab-case** for component filenames (`user-card.tsx`)
- **One task = one scope** — no drive-by refactors

### Don't

- `any` — use `unknown` + type guard
- `as` to bypass an Eden type — fix the API contract at the source
- `npm` / `yarn` / `pnpm` / `npx` / `node` — `bun` / `bunx` only. Exception: the tests that prove the packed CLI runs on Node drive it with `node`
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
- [ ] `bun run golden` passes when `registry/` or `templates/` changed
- [ ] No `any`, no `as` Eden
- [ ] New env vars → the module's `env` entry (it writes the project's `.env.example`)
- [ ] No files outside scope modified

---

## Deep docs (load on demand)

Do **not** preload everything. Open only what the current task needs:

| Need                                              | File                                                                                                                   |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Detailed clean-code / types / product conventions | [`docs/RULES.md`](./docs/RULES.md)                                                                                     |
| Test patterns                                     | [`docs/TESTING.md`](./docs/TESTING.md)                                                                                 |
| All scripts                                       | [`docs/COMMANDS.md`](./docs/COMMANDS.md)                                                                               |
| System architecture                               | [`docs/ARCHITECTURE.md`](./docs/ARCHITECTURE.md)                                                                       |
| Design system                                     | [`docs/DESIGN.md`](./docs/DESIGN.md)                                                                                   |
| Environment variables                             | [`docs/ENVIRONMENT.md`](./docs/ENVIRONMENT.md)                                                                         |
| How agent files are wired across tools            | [`docs/AGENTING.md`](./docs/AGENTING.md)                                                                               |
| Elysia routes, validation, plugins, Eden          | [Official Elysia skill](./.claude/skills/elysiajs/SKILL.md) — follow repo conventions when its generic examples differ |
