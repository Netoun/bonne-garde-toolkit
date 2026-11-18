import { styleText } from "node:util";
import type { IntentionOutcome } from "@bonne-garde/schema";
import { addItems, searchItems, viewItem } from "./add";
import { takeFlag, takeOption } from "./args";
import { APPS, FEATURES, PROVIDERS } from "./choices";
import { createCommand } from "./create-command";
import { doctorExitCode, formatDoctor, runDoctor } from "./doctor";
import { lintIntentions } from "./intentions/lint";
import { lintModuleIntentions } from "./intentions/lint-modules";
import { listRegistry } from "./list";
import { PACKAGE_MANAGERS, packageManagerOf } from "./package-manager";
import { migrationsDir, registryDir } from "./paths";
import { recordIntentionOutcome } from "./record";
import { manifestMigrationNotice, reportAdd } from "./report";
import { clack, logo, showAdd, step } from "./terminal";

function usage(): string {
  const section = (title: string) => styleText("bold", title);
  return `
${logo("compose a full-stack project from a registry of modules")}

${section("Start")}
  bg create [dir] [--pm <name>] [--apps <a,b>] [--provider <name>] [--features <a,b>]
                  [--yes] [--no-git] [--no-install] [--scope @name] [--registry <source>]
      asks, on a terminal, what no flag says; with --yes or no terminal it takes the defaults:
      the package manager create was started from (bun otherwise), and no app (the base alone)
      pm: ${PACKAGE_MANAGERS.join(", ")} · apps: ${APPS.join(", ")} · provider: ${PROVIDERS.join(", ")}
      features: ${FEATURES.join(", ")}

${section("Compose")}
  bg add <name...> [--dry-run] [--force] [--no-install] [--yes] [--json] [--source <source>]
      <name> is an item, a module id, or <category>/<id> (provider/cloudflare); prints a summary
      on a terminal, and JSON to a pipe, to an agent, or with --json
  bg list [--items | --category <category>] [--source <source>]
      with no flag: the items, then the modules as <category>/<id>; --items is the items alone
  bg search <query> [--source <source>]
  bg view <item> [--source <source>]
      <source> is local:<path> or github:owner/repo[@ref]; a github source reads raw.githubusercontent.com
      (set GITHUB_TOKEN to lift the rate limit); with no @ref it reads the tag v<platform.version> of bg.json

${section("Keep it healthy")}
  bg doctor [--json] [--strict]
  bg record <intention-id> [--skip "<reason>"]
  bg intentions lint [--dir <migrations-dir>] [--registry <registry-dir>]
      the release migrations, and the intentions each module ships under its intent/
`;
}

export async function runCli(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (!command || command === "-h" || command === "--help") {
    console.log(usage());
    return 0;
  }

  if (command === "create") {
    return createCommand(rest);
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
    // JSON on stdout for an agent, a pipe, or --json; a summary for a person at a terminal.
    const json = takeFlag(args, "--json") || process.stdout.isTTY !== true;
    if (args.length === 0) {
      throw new Error("add requires at least one item or module");
    }
    if (!json) {
      clack.intro(styleText("inverse", " bg add "));
      try {
        const outcome = await step(
          `${dryRun ? "Planning" : "Adding"} ${args.join(", ")}`,
          () =>
            addItems({
              items: args,
              source,
              dryRun,
              force,
              install: !noInstall,
              installOutput: "capture",
            }),
          ({ modulePlans, plan }) => {
            const names = [
              ...modulePlans.map(({ key }) => key),
              ...plan.items.map(({ name }) => name),
            ];
            const shown =
              names.length > 4
                ? `${names.slice(0, 4).join(", ")} and ${names.length - 4} more`
                : names.join(", ");
            return `${dryRun ? "Planned" : "Added"} ${shown}`;
          },
        );
        showAdd(outcome, dryRun, await packageManagerOf(process.cwd()).catch(() => null));
        clack.outro(dryRun ? "Nothing written: --dry-run." : "En garde.");
        return 0;
      } catch (error) {
        clack.cancel(error instanceof Error ? error.message : String(error));
        return 1;
      }
    }
    const outcome = await addItems({
      items: args,
      source,
      dryRun,
      force,
      install: !noInstall,
    });
    const { plan, modulePlans, result, staged } = outcome;
    const { failedPatches, stagedAt } = reportAdd(outcome, dryRun);
    console.log(
      JSON.stringify(
        {
          dryRun,
          items: plan.items.map((i) => i.name),
          // The dependencies an item adds to the package.json its files land in (030): a patch each, owned by the item.
          itemPatches: result.patches
            .filter((patch) => plan.items.some((item) => item.name === patch.module))
            .map(({ module, ...patch }) => ({ item: module, ...patch })),
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
            patches: result.patches
              .filter((patch) => patch.module === module.key)
              .map(({ module: _module, ...patch }) => patch),
          })),
          failedPatches,
          pendingIntentions: [
            ...result.pending.map(({ id, module, type, file, intent, reason }) => ({
              id,
              module,
              type,
              file,
              intent,
              reason,
              staged: stagedAt.get(id) ?? null,
            })),
            // An intention a module ships is no failed patch: it has no patch type, file or reason.
            ...result.authored.map(({ id, module, title }) => ({
              id,
              module,
              type: null,
              file: null,
              intent: title,
              reason: null,
              staged: stagedAt.get(id) ?? null,
            })),
          ],
          session: staged?.session ?? null,
          written: result.written,
          skippedIdentical: result.skippedIdentical,
          kept: result.kept,
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
    const { recordedIn, migratedFrom, staged, marked, notFiles } = await recordIntentionOutcome(
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
    for (const path of notFiles) {
      console.error(
        `bg: ${path} is not a file of the project, so ${id} did not mark it as edited by it.`,
      );
    }
    console.log(
      outcome.status === "applied"
        ? `recorded ${id} as applied in ${recordedIn}` +
            (marked.length > 0 ? `, and marked ${marked.join(", ")} as edited by it` : "")
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
    const registryOpt = takeOption(args, "--registry");
    const dir = dirOpt ?? migrationsDir();
    if (!dir) {
      throw new Error("migrations directory not found (pass --dir)");
    }
    const registry = registryOpt ?? registryDir();
    if (!registry) {
      throw new Error("registry directory not found (pass --registry)");
    }
    // One linter for both producers (065): the release migrations, then the intentions of modules.
    const result = await lintIntentions(dir);
    const modules = await lintModuleIntentions(registry);
    console.log(
      JSON.stringify(
        {
          ok: true,
          releases: result.releases,
          modules,
        },
        null,
        2,
      ),
    );
    return 0;
  }

  throw new Error(`unknown command: ${command}\n${usage()}`);
}
