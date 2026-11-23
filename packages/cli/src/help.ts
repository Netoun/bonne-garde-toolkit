import { styleText } from "node:util";
import { APPS, FEATURES, PROVIDERS } from "./choices";
import { PACKAGE_MANAGERS } from "./package-manager";
import { logo } from "./terminal";

/** What each command prints for `<command> --help`; the global usage is made of the same blocks. */
const HELP: Record<string, string> = {
  create: `  bonne-garde create [dir] [--pm <name>] [--apps <a,b>] [--provider <name>] [--features <a,b>]
                           [--yes] [--no-git] [--no-install] [--scope @name] [--registry <source>]
      asks, on a terminal, what no flag says; with --yes or no terminal it takes the defaults:
      the package manager create was started from (bun otherwise), and no app (the base alone)
      pm: ${PACKAGE_MANAGERS.join(", ")} · apps: ${APPS.join(", ")} · provider: ${PROVIDERS.join(", ")}
      features: ${FEATURES.join(", ")}`,
  add: `  bonne-garde add <name...> [--dry-run] [--force] [--no-install] [--yes] [--json] [--source <source>]
      <name> is an item, a module id, or <category>/<id> (provider/cloudflare); prints a summary
      on a terminal, and JSON to a pipe, to an agent, or with --json`,
  list: `  bonne-garde list [--items | --category <category>] [--source <source>]
      with no flag: the items, then the modules as <category>/<id>; --items is the items alone`,
  search: "  bonne-garde search <query> [--source <source>]",
  view: "  bonne-garde view <item> [--source <source>]",
  doctor: "  bonne-garde doctor [--json] [--strict]",
  record: '  bonne-garde record <intention-id> [--skip "<reason>"]',
  intentions: `  bonne-garde intentions lint [--dir <migrations-dir>] [--registry <registry-dir>]
      the release migrations, and the intentions each module ships under its intent/`,
};

/** What `list`, `search` and `view` say of their `--source`, once in the global usage. */
const SOURCE_NOTE = `      <source> is local:<path> or github:owner/repo[@ref]; a github source reads raw.githubusercontent.com
      (set GITHUB_TOKEN to lift the rate limit); with no @ref it reads the tag v<platform.version> of bg.json`;

export const COMMANDS = Object.keys(HELP);

export function usage(): string {
  const section = (title: string) => styleText("bold", title);
  return `
${logo("compose a full-stack project from a registry of modules")}

${section("Start")}
${HELP.create}

${section("Compose")}
${HELP.add}
${HELP.list}
${HELP.search}
${HELP.view}
${SOURCE_NOTE}

${section("Keep it healthy")}
${HELP.doctor}
${HELP.record}
${HELP.intentions}
`;
}

/** The usage of one command, or `undefined` when it is not one. */
export function commandHelp(command: string): string | undefined {
  const block = HELP[command];
  if (block === undefined) {
    return undefined;
  }
  return ["list", "search", "view"].includes(command) ? `${block}\n${SOURCE_NOTE}` : block;
}

/** The flags a command's usage names: what a mistyped flag is compared with. */
export function flagsOf(command: string): string[] {
  return [...new Set(HELP[command]?.match(/--[a-z][a-z-]*/g) ?? [])];
}
