# dev/agent-hooks

Hooks for the three coding agents of the project, written in TypeScript on one contract. Each agent's payload goes through a thin adapter to a `HookEvent` (`shell`, `edit` before or after, `stop`), and a hook answers a `HookResult` (allow, warn or block).

```bash
bunx bonne-garde add tooling/vite-plus dev/agent-hooks
```

## Category

The target named `tooling/agent-hooks`, but `tooling` admits one module and `vite-plus` fills it. The module sits in `dev` (many, local, never on the runtime path) and peers on `tooling/vite-plus`: without it, `add` fails with `needs a module in category tooling (vite-plus) and none is installed`.

## The hooks

| Hook         | When                              | What it does                                                                                                                                                                                               |
| ------------ | --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `guard`      | before a shell command or an edit | Refuses an edit of a lockfile, `bg.json` or a `*.generated.*` file; a package manager other than the project's `packageManager`; `git push`. Quoted text and heredoc bodies are data                       |
| `format`     | after an edit                     | `vp fmt --write <file>`. Never blocks: a formatter failure is a warning                                                                                                                                    |
| `stop-check` | end of turn                       | `vp check` on the code files changed since `HEAD` (untracked included), and `vp run typecheck` in each `apps/<x>` or `packages/<x>` that has the script. A failure blocks once; on the retry it only warns |

## Agents

| Agent       | Wiring                                                                              | Block is                                                          |
| ----------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Claude Code | `.claude/settings.json`: PreToolUse, PostToolUse, Stop                              | exit 2, reason on stderr                                          |
| Cursor      | `.cursor/hooks.json`: beforeShellExecution, preToolUse (Write), afterFileEdit, stop | `deny` answer and exit 2; the stop report is a `followup_message` |
| OpenCode    | `.opencode/plugins/agent-hooks.ts`, in-process                                      | a thrown error; the stop report is sent back as a prompt once     |

Claude and Cursor run `./node_modules/.bin/tsx scripts/agent-hooks/run.ts <claude|cursor>` with the agent's JSON on stdin. The plugin calls the same `handle()` with `{ hook, tool, args }`.

## Writes

`scripts/agent-hooks/*` (the hooks, their test and a tsconfig), `.claude/settings.json`, `.cursor/hooks.json`, `.opencode/plugins/agent-hooks.ts`. No patch. The module's `checks`: `tsc --project scripts/agent-hooks/tsconfig.json` and `vp test scripts/agent-hooks/agent-hooks.test.ts`. The tests inject the executor: no real build runs.

## Known limits

- `.claude/settings.json` is copied whole: a project that already has one gets the conflict policy's answer, not a merge.
- The OpenCode payload shapes (`tool.execute.after` carrying `args`, `client.session.prompt`) follow its plugin docs and are not exercised against a running OpenCode.
- Cursor's `preToolUse` Write payload is read from `file_path` or `path`.
- `git push` is refused for every agent, including in a project where the agent is meant to push: remove the check in `guard.ts` there.
