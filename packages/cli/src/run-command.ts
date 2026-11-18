import { spawn } from "node:child_process";

export type CommandResult = { status: "exited"; code: number } | { status: "not-found" };

/**
 * Runs a command and waits for it. One that is not on PATH is a result the caller decides about,
 * not an ENOENT stack trace; one a signal ended counts as failed, since it has no exit code.
 */
export function runCommand(
  command: string,
  args: string[],
  options: { cwd: string; stdio: "inherit" | "ignore" },
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: options.cwd, stdio: options.stdio });
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({ status: "not-found" });
      } else {
        reject(error);
      }
    });
    child.once("close", (code) => resolve({ status: "exited", code: code ?? 1 }));
  });
}

/**
 * `runCommand`, and with `output: "capture"` what the command printed, both streams in the order they
 * came: what a spinner shows instead of the command's own output, and prints when it fails.
 */
export function runCapturing(
  argv: readonly [string, ...string[]],
  options: { cwd: string; output: "inherit" | "ignore" | "capture"; env?: NodeJS.ProcessEnv },
): Promise<{ status: "exited"; code: number; printed: string } | { status: "not-found" }> {
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
    child.once("error", (error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") {
        resolve({ status: "not-found" });
      } else {
        reject(error);
      }
    });
    child.once("close", (code) => resolve({ status: "exited", code: code ?? 1, printed }));
  });
}
