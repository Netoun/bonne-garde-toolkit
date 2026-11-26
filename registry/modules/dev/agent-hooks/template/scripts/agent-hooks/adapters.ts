import { ALLOW, type Exec, type HookEvent, type HookResult } from "./contract.ts";
import { formatAfterEdit } from "./format.ts";
import { guard, type GuardOptions } from "./guard.ts";
import { stopCheck } from "./stop-check.ts";

/** What a hook process writes back to its agent. */
export type Reply = { code: number; stdout: string; stderr: string };

export type Adapter = {
  /** The native payload as a `HookEvent`, or undefined for a tool or an event no hook handles. */
  parse(payload: unknown, cwd: string): HookEvent | undefined;
  reply(result: HookResult): Reply;
};

function record(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? Object.fromEntries(Object.entries(value))
    : {};
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

const STDERR_BLOCK = (result: HookResult): Reply =>
  result.block
    ? { code: 2, stdout: "", stderr: result.message }
    : { code: 0, stdout: "", stderr: result.warning ?? "" };

/** Claude Code: `hook_event_name` is PreToolUse, PostToolUse or Stop; exit code 2 blocks, stderr goes to the agent. */
export const claude: Adapter = {
  parse(payload, cwd) {
    const data = record(payload);
    const input = record(data.tool_input);
    const base = { cwd: text(data.cwd) ?? cwd };
    if (data.hook_event_name === "Stop") {
      return { kind: "stop", ...base, retry: data.stop_hook_active === true };
    }
    const phase = data.hook_event_name === "PreToolUse" ? "before" : "after";
    if (data.tool_name === "Bash") {
      const command = text(input.command);
      return phase === "before" && command ? { kind: "shell", command, ...base } : undefined;
    }
    const path = text(input.file_path) ?? text(input.notebook_path);
    return ["Edit", "Write", "MultiEdit", "NotebookEdit"].includes(String(data.tool_name)) && path
      ? { kind: "edit", phase, path, ...base }
      : undefined;
  },
  reply: STDERR_BLOCK,
};

/**
 * Cursor: `beforeShellExecution`, `preToolUse` (Write), `afterFileEdit` and `stop`. A block is a
 * `deny` answer, and exit code 2 as well; the stop hook sends the report as a follow-up message.
 */
export const cursor: Adapter = {
  parse(payload, cwd) {
    const data = record(payload);
    const input = record(data.tool_input);
    const base = { cwd: text(data.cwd) ?? cwd };
    switch (data.hook_event_name) {
      case "beforeShellExecution": {
        const command = text(data.command);
        return command ? { kind: "shell", command, ...base } : undefined;
      }
      case "preToolUse": {
        if (data.tool_name === "Shell") {
          const command = text(input.command);
          return command ? { kind: "shell", command, ...base } : undefined;
        }
        const path = text(input.file_path) ?? text(input.path);
        return data.tool_name === "Write" && path
          ? { kind: "edit", phase: "before", path, ...base }
          : undefined;
      }
      case "afterFileEdit": {
        const path = text(data.file_path);
        return path ? { kind: "edit", phase: "after", path, ...base } : undefined;
      }
      case "stop":
        return { kind: "stop", ...base, retry: Number(data.loop_count) > 0 };
      default:
        return undefined;
    }
  },
  reply(result) {
    if (!result.block)
      return {
        code: 0,
        stdout: JSON.stringify({ permission: "allow" }),
        stderr: result.warning ?? "",
      };
    const answer = {
      permission: "deny",
      user_message: result.message,
      agent_message: result.message,
      followup_message: result.message,
    };
    return { code: 2, stdout: JSON.stringify(answer), stderr: "" };
  },
};

/**
 * OpenCode runs in-process: the plugin hands `tool.execute.before` / `tool.execute.after` and
 * `session.idle` over as `{ hook, tool, args, retry? }`. A block is a thrown error (`reply.code` 2).
 */
export const opencode: Adapter = {
  parse(payload, cwd) {
    const data = record(payload);
    const args = record(data.args);
    const base = { cwd };
    if (data.hook === "session.idle") return { kind: "stop", ...base, retry: data.retry === true };
    const phase = data.hook === "tool.execute.before" ? "before" : "after";
    if (data.tool === "bash") {
      const command = text(args.command);
      return phase === "before" && command ? { kind: "shell", command, ...base } : undefined;
    }
    const path = text(args.filePath);
    return ["edit", "write"].includes(String(data.tool)) && path
      ? { kind: "edit", phase, path, ...base }
      : undefined;
  },
  reply: STDERR_BLOCK,
};

export const ADAPTERS = { claude, cursor, opencode } as const;

export type Deps = { exec: Exec; options: GuardOptions };

/** One hook call: the native payload, through the adapter, to the hook its event names, and back. */
export function handle(adapter: Adapter, payload: unknown, cwd: string, deps: Deps): Reply {
  const event = adapter.parse(payload, cwd);
  if (!event) return adapter.reply(ALLOW);
  // Each hook answers ALLOW to an event that is not its own.
  const results = [
    guard(event, deps.options),
    formatAfterEdit(event, deps.exec),
    stopCheck(event, deps.exec),
  ];
  return adapter.reply(
    results.find((result) => result.block) ??
      results.find((result) => !result.block && result.warning) ??
      ALLOW,
  );
}
