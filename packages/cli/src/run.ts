import { spawn } from "node:child_process";

/**
 * Runs a command to its end and resolves with its exit code; one that cannot start rejects. Node's
 * API, which Bun implements too, so the CLI runs on either (040).
 */
export function run(
  argv: readonly [string, ...string[]],
  options: { cwd: string; output: "inherit" | "ignore"; env?: NodeJS.ProcessEnv },
): Promise<number> {
  const [command, ...args] = argv;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", options.output, options.output],
    });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}
