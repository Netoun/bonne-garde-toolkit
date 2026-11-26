/**
 * The one contract every agent's hook is mapped to. An adapter (`adapters.ts`) turns the payload of
 * Claude Code, Cursor or OpenCode into a `HookEvent`; a hook decides on it and answers a `HookResult`.
 */
export type HookEvent =
  | { kind: "shell"; command: string; cwd: string }
  | { kind: "edit"; phase: "before" | "after"; path: string; cwd: string }
  /** `retry`: the agent already went back to work once because of this hook in this turn. */
  | { kind: "stop"; cwd: string; retry: boolean };

export type HookResult = { block: false; warning?: string } | { block: true; message: string };

/** Runs a command in a directory; injected so a hook is tested without running a real check. */
export type Exec = (command: string[], cwd: string) => { code: number; output: string };

export const ALLOW: HookResult = { block: false };
