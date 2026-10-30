import type { IntentionOutcome } from "@bonne-garde/schema";
import { addItems, searchItems, viewItem } from "./add";
import { createProject } from "./create";
import { doctorExitCode, formatDoctor, runDoctor } from "./doctor";
import { lintIntentions } from "./intentions/lint";
import { listRegistry } from "./list";
import { migrationsDir } from "./paths";
import { recordIntentionOutcome } from "./record";

function usage(): string {
  return `bg — Bonne Garde CLI

Usage:
  bg create <dir> [--yes] [--no-git] [--no-install] [--scope @name] [--registry <source>]
  bg list [--items | --category <category>] [--source <source>]
      with no flag: the items, then the modules as <category>/<id>; --items is the items alone
  bg search <query> [--source <source>]
  bg view <item> [--source <source>]
  bg add <name...> [--dry-run] [--force] [--no-install] [--yes] [--source <source>]
      <name> is an item, a module id, or <category>/<id> (provider/cloudflare)
      <source> is local:<path> or github:owner/repo[@ref]; a github source reads raw.githubusercontent.com
      (set GITHUB_TOKEN to lift the rate limit); with no @ref it reads the tag v<platform.version> of bg.json
  bg record <intention-id> [--skip "<reason>"]
  bg doctor [--json] [--strict]
  bg intentions lint [--dir <migrations-dir>]
`;
}

/** Spec 020: a v1 `bg.json` is rewritten as v2 on the next write, and that is stated, not silent. */
function manifestMigrationNotice(dryRun: boolean): string {
  const changes =
    '"installed" becomes "items", "capabilities" is dropped, and "files" and "regions" start empty';
  return dryRun
    ? `bg: bg.json is version 1; a real run will rewrite it as version 2 (${changes}). Not written: --dry-run.`
    : `bg: rewrote bg.json from version 1 to version 2 (${changes}). Files already in the project are user-owned until re-added.`;
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
    const itemsOnly = takeFlag(args, "--items");
    const category = takeOption(args, "--category");
    const source = takeOption(args, "--source");
    // A flag it did not recognise must fail: `list --itmes` would print the modules it meant to leave out.
    if (args.length > 0) {
      throw new Error(`list: unexpected argument: ${args.join(" ")}\n${usage()}`);
    }
    const { lines, notes } = await listRegistry(process.cwd(), { itemsOnly, category, source });
    for (const note of notes) {
      console.error(note);
    }
    for (const line of lines) {
      console.log(line);
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
    // Spec 050: --yes selects option defaults and never prompts. `add` has no prompt at all, so it
    // is accepted and changes nothing: options always resolve from their defaults.
    takeFlag(args, "--yes");
    const source = takeOption(args, "--source");
    if (takeOption(args, "--set") !== undefined) {
      throw new Error(
        "--set is not supported yet: options resolve from their defaults, and spec 050 does not say which module a key addresses when several are named",
      );
    }
    if (args.length === 0) {
      throw new Error("add requires at least one item or module");
    }
    const { plan, modulePlans, result, migratedFrom } = await addItems({
      items: args,
      source,
      dryRun,
      force,
      install: !noInstall,
    });
    if (migratedFrom !== null) {
      console.error(manifestMigrationNotice(dryRun));
    }
    for (const { path, from, by } of result.tookOver) {
      console.error(`bg: ${path} was owned by ${from}; ${by} now owns it`);
    }
    const unrun = modulePlans.filter((module) => module.checks.length > 0);
    if (unrun.length > 0) {
      console.error(
        `bg: checks were not run (spec 050 step 15 is not implemented): ${unrun
          .map((module) => `${module.key}: ${module.checks.join("; ")}`)
          .join(" | ")}`,
      );
    }
    console.log(
      JSON.stringify(
        {
          dryRun,
          items: plan.items.map((i) => i.name),
          modules: modulePlans.map((module) => ({
            module: module.key,
            variant: module.variant,
            options: module.options,
            files: module.files.map((file) => file.target),
            env: module.env.map(({ name, required }) => ({
              name,
              required,
              status: result.env?.added.some((a) => a.name === name && a.owner === module.key)
                ? "added"
                : "present",
            })),
            dependencies: module.dependencies,
            devDependencies: module.devDependencies,
            workspace: module.workspace,
            checks: module.checks,
          })),
          written: result.written,
          skippedIdentical: result.skippedIdentical,
          tookOver: result.tookOver,
          envFile: result.env?.file ?? null,
          npmDependencies: plan.npmDependencies,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  if (command === "remove" || command === "replace") {
    throw new Error(
      `bg ${command} is not supported yet: spec 050 "remove and replace" is not implemented`,
    );
  }

  if (command === "record") {
    const args = [...rest];
    const reason = takeOption(args, "--skip");
    const id = args.shift();
    if (!id) {
      throw new Error("record requires an intention id");
    }
    if (args.length > 0) {
      throw new Error(`record: unexpected argument: ${args.join(" ")}\n${usage()}`);
    }
    const outcome: IntentionOutcome =
      reason === undefined ? { status: "applied" } : { status: "skipped", reason };
    const { recordedIn, migratedFrom, staged } = await recordIntentionOutcome(
      process.cwd(),
      id,
      outcome,
    );
    if (migratedFrom !== null) {
      console.error(manifestMigrationNotice(false));
    }
    if (!staged) {
      console.error(
        `bg: ${id} is not staged under .bg/; recorded anyway (the scratch root is disposable).`,
      );
    }
    console.log(
      outcome.status === "applied"
        ? `recorded ${id} as applied in ${recordedIn}`
        : `recorded ${id} as skipped in ${recordedIn}: ${outcome.reason}`,
    );
    return 0;
  }

  if (command === "doctor") {
    const args = [...rest];
    const json = takeFlag(args, "--json");
    const strict = takeFlag(args, "--strict");
    // A flag it did not recognise must fail: `doctor --strcit` passing in CI is a gate that is off.
    if (args.length > 0) {
      throw new Error(`doctor: unexpected argument: ${args.join(" ")}\n${usage()}`);
    }
    const doctor = await runDoctor(process.cwd());
    console.log(json ? JSON.stringify(doctor, null, 2) : formatDoctor(doctor));
    return doctorExitCode(doctor, strict);
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
