import { existsSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { ALLOW, type Exec, type HookEvent, type HookResult } from "./contract.ts";

const CODE = new Set([".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"]);
const TAIL_LINES = 40;

/** The code files changed since HEAD, untracked ones included. */
function changedCode(cwd: string, exec: Exec): string[] {
  const listings = [
    ["git", "diff", "--name-only", "--diff-filter=ACMR", "HEAD"],
    ["git", "ls-files", "--others", "--exclude-standard"],
  ];
  const files = listings.flatMap((command) => exec(command, cwd).output.split("\n"));
  return [
    ...new Set(files.filter((file) => CODE.has(extname(file)) && !file.includes("node_modules/"))),
  ];
}

/** The `apps/<x>` or `packages/<x>` directory of a file, when its package.json has a `typecheck` script. */
function typecheckDirectory(file: string, cwd: string): string | undefined {
  const [top, name] = file.split("/");
  if ((top !== "apps" && top !== "packages") || !name) return undefined;
  const manifest = join(cwd, top, name, "package.json");
  if (!existsSync(manifest)) return undefined;
  const parsed: unknown = JSON.parse(readFileSync(manifest, "utf8"));
  const scripts =
    typeof parsed === "object" && parsed !== null && "scripts" in parsed
      ? parsed.scripts
      : undefined;
  return typeof scripts === "object" && scripts !== null && "typecheck" in scripts
    ? join(top, name)
    : undefined;
}

/**
 * At the end of a turn: `vp check` on the changed files, and the typecheck of the packages they sit in.
 * A failure blocks the stop so the agent fixes it; on a retry it only warns, so a red check that is
 * not the agent's never traps the turn.
 */
export function stopCheck(event: HookEvent, exec: Exec): HookResult {
  if (event.kind !== "stop") return ALLOW;
  const files = changedCode(event.cwd, exec);
  if (files.length === 0) return ALLOW;
  const runs: { title: string; command: string[]; cwd: string }[] = [
    { title: "vp check", command: ["vp", "check", ...files], cwd: event.cwd },
  ];
  const directories = new Set(files.map((file) => typecheckDirectory(file, event.cwd)));
  for (const directory of [...directories].filter((entry) => entry !== undefined).sort()) {
    runs.push({
      title: `typecheck ${directory}`,
      command: ["vp", "run", "typecheck"],
      cwd: join(event.cwd, directory),
    });
  }
  const failures = runs.flatMap(({ title, command, cwd }) => {
    const { code, output } = exec(command, cwd);
    return code === 0 ? [] : [`${title}\n${output.split("\n").slice(-TAIL_LINES).join("\n")}`];
  });
  if (failures.length === 0) return ALLOW;
  const report = failures.join("\n\n");
  return event.retry
    ? { block: false, warning: `End-of-turn check still failing:\n${report}` }
    : {
        block: true,
        message: `End-of-turn check failed on the files you changed. Fix it before you stop.\n\n${report}`,
      };
}
