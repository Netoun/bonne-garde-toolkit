# Agent tooling

How AI coding agents are configured in this repo, and how to keep them in sync.

## Principle

**One canonical file: [`AGENTS.md`](../AGENTS.md).**  
Tool-specific files are thin shims. Never copy stack, commands, or do/don't lists into multiple places.

```
AGENTS.md                 ← edit here only (Codex / OpenCode / Cursor native)
├── CLAUDE.md             ← Claude Code: @AGENTS.md import
└── .cursor/rules/agents.mdc  ← Cursor: alwaysApply pointer
```

Deep detail stays in `docs/` (`RULES.md`, `TESTING.md`, …). Agents must load those **on demand**, not at session start.

## Tool matrix

| Tool                                                          | Entry                                    | Notes                                                             |
| ------------------------------------------------------------- | ---------------------------------------- | ----------------------------------------------------------------- |
| [OpenAI Codex](https://agents.md/)                            | `AGENTS.md`                              | Native standard                                                   |
| [OpenCode](https://opencode.ai/docs/rules/)                   | `AGENTS.md`                              | If both exist, `AGENTS.md` wins over `CLAUDE.md`                  |
| [Cursor](https://cursor.com/)                                 | `AGENTS.md` + `.cursor/rules/agents.mdc` | Rule file only points at `AGENTS.md`                              |
| [Claude Code](https://docs.anthropic.com/en/docs/claude-code) | `CLAUDE.md`                              | Starts with `@AGENTS.md`; see "Claude Code and `AGENTS.md`" below |

### Claude Code and `AGENTS.md`

Observed on Claude Code 2.1.325, and not checked on any other version:

- A root `AGENTS.md` is loaded when the project has no `CLAUDE.md`.
- A nested `apps/<app>/AGENTS.md` is not loaded from the project root, which is why `templates/base/AGENTS.md` tells the agent to read an app's or a package's own `AGENTS.md`.

Nothing was observed about a project that has both a `CLAUDE.md` and an `AGENTS.md`: this repo keeps `CLAUDE.md` as the file that imports `AGENTS.md`.

Optional OpenCode config: [`opencode.json`](../opencode.json). Prefer lazy links from `AGENTS.md` over an always-on `instructions` array (those files are injected every session and inflate context).

## Maintenance rules

1. Change agent behavior → edit **`AGENTS.md`** only.
2. Add a Claude-only quirk → put it **below** `@AGENTS.md` in `CLAUDE.md`.
3. Add a Cursor file-scoped quirk → new `.cursor/rules/*.mdc` with `globs`, **without** duplicating `AGENTS.md`.
4. After changing commands/scripts → run `bun run gen:commands` (and architecture gen if needed).
5. Do **not** symlink `CLAUDE.md` → `AGENTS.md` on this repo: `CLAUDE.md` is the file that imports `AGENTS.md` and holds the Claude-only quirks (rule 2); OpenCode already prefers `AGENTS.md`.

## Project skills for Claude Code

Skills are installed locally in `.claude/skills/`, with their upstream sources and content hashes recorded in [`skills-lock.json`](../skills-lock.json). They travel with the boilerplate; no global installation is required.

| Skill                         | Source                     | Use                                                                    |
| ----------------------------- | -------------------------- | ---------------------------------------------------------------------- |
| `elysiajs`                    | `elysiajs/skills`          | Routes, validation, Eden and auth integration                          |
| `impeccable`                  | `pbakaus/impeccable`       | UI design, UX audits, accessibility and polish                         |
| `frontend-design`             | `anthropics/skills`        | Visual direction for new interfaces                                    |
| `vercel-react-best-practices` | `vercel-labs/agent-skills` | React rendering and performance                                        |
| `vercel-composition-patterns` | `vercel-labs/agent-skills` | Compound components and reusable React APIs                            |
| `cloudflare`                  | `cloudflare/skills`        | Cloudflare product selection and documentation                         |
| `workers-best-practices`      | `cloudflare/skills`        | Worker runtime and configuration review                                |
| `wrangler`                    | `cloudflare/skills`        | Project-local CLI commands and resource management                     |
| `web-perf`                    | `cloudflare/skills`        | Browser performance audits (available tooling determines measurements) |

Load skills only for matching tasks. Repo conventions in `AGENTS.md` take precedence over generic examples: use Bun, Vite+, React Router, Eden and shared shadcn primitives. Apply React guidance that fits this stack; Next.js-specific examples do not imply a framework migration. Keep the starter's non-AOT Elysia configuration and existing platform boundaries.

Impeccable's launcher is `.claude/skills/impeccable/scripts/impeccable`. Its first invocation may download a version-pinned engine into the user's cache and verify its checksum. Installing the skill does not enable its optional hooks or create product/design artifacts; those are separate, explicit actions.

Inspect project installations:

```bash
bunx skills list --agent claude-code --json
```

To update a selected project skill (review the resulting diff):

```bash
bunx skills update elysiajs --project --yes
```

## Related docs

| Audience                   | File                                    |
| -------------------------- | --------------------------------------- |
| Agents (canonical)         | [`AGENTS.md`](../AGENTS.md)             |
| Humans (contribute)        | [`CONTRIBUTING.md`](../CONTRIBUTING.md) |
| Detailed engineering rules | [`RULES.md`](./RULES.md)                |
| Tests                      | [`TESTING.md`](./TESTING.md)            |
