import { extname } from "node:path";
import { ALLOW, type Exec, type HookEvent, type HookResult } from "./contract.ts";

const FORMATTED = new Set([
  ".ts",
  ".tsx",
  ".mts",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".css",
  ".md",
]);

/** After an edit, `vp fmt --write` on that one file. Never blocks: a formatter error is not the agent's turn to fix. */
export function formatAfterEdit(event: HookEvent, exec: Exec): HookResult {
  if (event.kind !== "edit" || event.phase !== "after" || !FORMATTED.has(extname(event.path))) {
    return ALLOW;
  }
  const { code, output } = exec(["vp", "fmt", "--write", event.path], event.cwd);
  return code === 0
    ? ALLOW
    : { block: false, warning: `vp fmt failed on ${event.path}\n${output}` };
}
