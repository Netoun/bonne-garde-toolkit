import { addItems, listItems, searchItems, viewItem } from "./add";
import { createProject } from "./create";
import { lintIntentions } from "./intentions/lint";
import { migrationsDir } from "./paths";

function usage(): string {
  return `bg — Bonne Garde CLI

Usage:
  bg create <dir> [--yes] [--no-git] [--no-install] [--scope @name] [--registry <source>]
  bg list [--source <source>]
  bg search <query> [--source <source>]
  bg view <item> [--source <source>]
  bg add <item...> [--dry-run] [--force] [--no-install] [--source <source>]
  bg intentions lint [--dir <migrations-dir>]
`;
}

function takeFlag(args: string[], name: string): boolean {
  const index = args.indexOf(name);
  if (index === -1) {
    return false;
  }
  args.splice(index, 1);
  return true;
}

function takeOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) {
    return undefined;
  }
  const value = args[index + 1];
  if (!value) {
    throw new Error(`missing value for ${name}`);
  }
  args.splice(index, 2);
  return value;
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    console.log(usage());
    return 0;
  }

  if (command === "create") {
    const args = [...rest];
    const yes = takeFlag(args, "--yes");
    const noGit = takeFlag(args, "--no-git");
    const noInstall = takeFlag(args, "--no-install");
    const scope = takeOption(args, "--scope");
    const registry = takeOption(args, "--registry");
    const name = args[0];
    if (!name) {
      throw new Error("create requires a directory name");
    }
    void yes;
    const target = await createProject({
      name,
      scope,
      registry,
      git: !noGit,
      install: !noInstall,
      yes,
    });
    console.log(`created ${target}`);
    return 0;
  }

  if (command === "list") {
    const args = [...rest];
    const source = takeOption(args, "--source");
    const items = await listItems(process.cwd(), source);
    for (const item of items) {
      console.log(`${item.name}\t${item.type}\t${item.description ?? ""}`);
    }
    return 0;
  }

  if (command === "search") {
    const args = [...rest];
    const source = takeOption(args, "--source");
    const query = args[0];
    if (!query) {
      throw new Error("search requires a query");
    }
    const items = await searchItems(process.cwd(), query, source);
    for (const item of items) {
      console.log(`${item.name}\t${item.type}\t${item.description ?? ""}`);
    }
    return 0;
  }

  if (command === "view") {
    const args = [...rest];
    const source = takeOption(args, "--source");
    const name = args[0];
    if (!name) {
      throw new Error("view requires an item name");
    }
    const item = await viewItem(process.cwd(), name, source);
    console.log(JSON.stringify(item, null, 2));
    return 0;
  }

  if (command === "add") {
    const args = [...rest];
    const dryRun = takeFlag(args, "--dry-run");
    const force = takeFlag(args, "--force");
    const noInstall = takeFlag(args, "--no-install");
    const source = takeOption(args, "--source");
    if (args.length === 0) {
      throw new Error("add requires at least one item");
    }
    const { plan, result } = await addItems({
      items: args,
      source,
      dryRun,
      force,
      install: !noInstall,
    });
    console.log(
      JSON.stringify(
        {
          dryRun,
          items: plan.items.map((i) => i.name),
          written: result.written,
          skippedIdentical: result.skippedIdentical,
          capabilities: plan.capabilities,
          npmDependencies: plan.npmDependencies,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "intentions") {
    const [sub, ...restArgs] = rest;
    if (sub !== "lint") {
      throw new Error(`unknown intentions subcommand: ${sub ?? "(missing)"}\n${usage()}`);
    }
    const args = [...restArgs];
    const dirOpt = takeOption(args, "--dir");
    const dir = dirOpt ?? migrationsDir();
    if (!dir) {
      throw new Error("migrations directory not found (pass --dir)");
    }
    const result = await lintIntentions(dir);
    console.log(
      JSON.stringify(
        {
          ok: true,
          releases: result.releases,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  throw new Error(`unknown command: ${command}\n${usage()}`);
}
