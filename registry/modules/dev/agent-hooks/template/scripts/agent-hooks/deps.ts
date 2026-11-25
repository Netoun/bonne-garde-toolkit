import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import type { Deps } from "./adapters.ts";

/** The real dependencies of a hook in the project at `root`: commands run with its `node_modules/.bin` first on PATH. */
export function nodeDeps(root: string): Deps {
  const bin = join(root, "node_modules", ".bin");
  return {
    exec(command, cwd) {
      const [program = "", ...args] = command;
      const env = { ...process.env, PATH: `${bin}${delimiter}${process.env.PATH ?? ""}` };
      const result = spawnSync(program, args, { cwd, env, encoding: "utf8" });
      return { code: result.status ?? 1, output: `${result.stdout}${result.stderr}`.trim() };
    },
    options: { packageManager: packageManager(root) },
  };
}

function packageManager(root: string): string | undefined {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
    return typeof parsed === "object" &&
      parsed !== null &&
      "packageManager" in parsed &&
      typeof parsed.packageManager === "string"
      ? parsed.packageManager
      : undefined;
  } catch {
    return undefined;
  }
}
