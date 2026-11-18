import { spawn } from "node:child_process";

/**
 * Runs a command to its end and resolves with its exit code; one that cannot start rejects. Node's
 * API, which Bun implements too, so the CLI runs on either (040).
 */
export function run(
  argv: readonly [string, ...string[]],
  options: { cwd: string; output: "inherit" | "ignore"; env?: NodeJS.ProcessEnv },
): Promise<number> {
  return runCapturing(argv, options).then(({ code }) => code);
}

/**
 * `run`, and with `output: "capture"` what the command printed, both streams in the order they came:
 * what a spinner shows instead of the command's own output, and prints when it fails.
 */
export function runCapturing(
  argv: readonly [string, ...string[]],
  options: { cwd: string; output: "inherit" | "ignore" | "capture"; env?: NodeJS.ProcessEnv },
): Promise<{ code: number; printed: string }> {
  const [command, ...args] = argv;
  const stream = options.output === "capture" ? "pipe" : options.output;
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      stdio: ["ignore", stream, stream],
    });
    let printed = "";
    const keep = (chunk: Buffer) => {
      printed += chunk.toString("utf8");
    };
    child.stdout?.on("data", keep);
    child.stderr?.on("data", keep);
    child.once("error", reject);
    child.once("close", (code) => resolve({ code: code ?? 1, printed }));
  });
}
