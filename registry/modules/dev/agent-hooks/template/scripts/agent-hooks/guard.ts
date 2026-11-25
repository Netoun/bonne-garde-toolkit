import { basename, isAbsolute, relative, resolve } from "node:path";
import { ALLOW, type HookEvent, type HookResult } from "./contract.ts";

const LOCKFILES = ["bun.lock", "bun.lockb", "pnpm-lock.yaml", "package-lock.json", "yarn.lock"];
const PACKAGE_MANAGERS = ["npm", "npx", "yarn", "pnpm"];
const COMMAND_PREFIXES = new Set(["sudo", "command", "exec", "nohup", "time", "env", "xargs"]);
const SEPARATORS = new Set([";", "&", "|", "(", ")", "\n"]);

export type GuardOptions = {
  /** The `packageManager` field of the root package.json (`pnpm@10.0.0`), when it has one. */
  packageManager?: string;
};

function block(message: string): HookResult {
  return { block: true, message: `Blocked by the agent guard. ${message}` };
}

/** The refusal for an edit of a file the project generates, or undefined. */
function generatedFile(path: string): string | undefined {
  const name = basename(path);
  if (LOCKFILES.includes(name)) {
    return "Lockfile: change dependencies with the package manager, never by hand.";
  }
  if (path === "bg.json") {
    return "bg.json is written by the bonne-garde CLI (checksums): use `bonne-garde add`.";
  }
  if (/\.generated\.[cm]?[jt]sx?$/.test(name)) {
    return "Generated file: change its source and run the generator script.";
  }
  return undefined;
}

/** The simple commands of a shell line, quoted text and heredoc bodies left out: `[name, ...args]`. */
export function simpleCommands(source: string): string[][] {
  const commands: string[][] = [];
  let words: string[] = [];
  let word = "";
  let quote = "";
  let inWord = false;
  let heredoc: string | undefined;
  const endWord = () => {
    if (inWord) words.push(word);
    word = "";
    inWord = false;
  };
  const endCommand = () => {
    endWord();
    let start = 0;
    while (
      start < words.length &&
      (COMMAND_PREFIXES.has(words[start] ?? "") || /^[A-Za-z_]\w*=/.test(words[start] ?? ""))
    ) {
      start += 1;
    }
    const [name, ...args] = words.slice(start);
    if (name !== undefined) commands.push([basename(name), ...args]);
    words = [];
  };
  for (const line of source.replace(/\\\n/g, " ").split("\n")) {
    if (heredoc !== undefined) {
      if (line.trim() === heredoc) heredoc = undefined;
      continue;
    }
    heredoc = /<<-?\s*(['"]?)(\w+)\1/.exec(line)?.[2];
    for (const char of line) {
      if (quote) {
        if (char === quote) quote = "";
        else word += char;
      } else if (char === '"' || char === "'") {
        quote = char;
        inWord = true;
      } else if (SEPARATORS.has(char)) {
        endCommand();
      } else if (/\s/.test(char)) {
        endWord();
      } else {
        word += char;
        inWord = true;
      }
    }
    endCommand();
  }
  return commands;
}

/** The git subcommand after global options such as `-C <path>` or `-c <key=value>`. */
function gitSubcommand(args: string[]): string | undefined {
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index] ?? "";
    if (["-C", "-c", "--git-dir", "--work-tree", "--namespace"].includes(arg)) index += 1;
    else if (!arg.startsWith("-")) return arg;
  }
  return undefined;
}

function guardShell(command: string, options: GuardOptions): HookResult {
  const own = options.packageManager?.split("@")[0];
  for (const [name = "", ...args] of simpleCommands(command)) {
    if (PACKAGE_MANAGERS.includes(name) && name !== own) {
      const use = own ? `this project uses ${own}` : "use the project's package manager";
      return block(
        `\`${name}\` is not allowed: ${use}, and a package.json script when one exists.`,
      );
    }
    if (name === "git" && gitSubcommand(args) === "push") {
      return block(
        "`git push` is left to the delivery step: commit, and say what is ready to push.",
      );
    }
  }
  return ALLOW;
}

export function guard(event: HookEvent, options: GuardOptions = {}): HookResult {
  if (event.kind === "shell") return guardShell(event.command, options);
  if (event.kind === "edit" && event.phase === "before") {
    const path = isAbsolute(event.path) ? event.path : resolve(event.cwd, event.path);
    const reason = generatedFile(relative(event.cwd, path));
    return reason ? block(reason) : ALLOW;
  }
  return ALLOW;
}
