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

/** A Bonne Garde project is a Bun monorepo, whichever runner started the CLI. */
export const BUN_MISSING =
  "a Bonne Garde project needs Bun (https://bun.sh): its files are written, run `bun install` in it once Bun is installed";

/** `bun install` in a project: `"bun-missing"` when there is no Bun to run it, an error when it fails. */
export async function bunInstall(
  cwd: string,
  failure: string,
): Promise<"installed" | "bun-missing"> {
  const result = await runCommand("bun", ["install"], { cwd, stdio: "inherit" });
  if (result.status === "not-found") {
    return "bun-missing";
  }
  if (result.code !== 0) {
    throw new Error(failure);
  }
  return "installed";
}
