import { existsSync } from "node:fs";
import { join } from "node:path";
import { styleText } from "node:util";
import { ApplyError } from "@bonne-garde/registry";
import { type IntentionOutcome } from "@bonne-garde/schema";
import { addItems, searchItems, viewItem } from "./add";
import { takeFlag, takeOption } from "./args";
import { createCommand } from "./create-command";
import { doctorExitCode, formatDoctor, renderDoctor, runDoctor } from "./doctor";
import { CliError, clackErrorText, errorText, notAProject, unknownName } from "./errors";
import { addNamingCommand } from "./force-command";
import { COMMANDS, commandHelp, flagsOf, usage } from "./help";
import { lintIntentions } from "./intentions/lint";
import { lintModuleIntentions } from "./intentions/lint-modules";
import { listRegistry } from "./list";
import { missingPackageManager, packageManagerOf } from "./package-manager";
import { cliVersion, migrationsDir, registryDir } from "./paths";
import { recordIntentionOutcome } from "./record";
import { manifestMigrationNotice, reportAdd } from "./report";
import { clack, showAdd, step } from "./terminal";

/** A flag the command does not know is a typo: it fails with the nearest flag, never as a name or a query. */
function refuseUnknownFlag(command: string, args: readonly string[]): void {
  const flag = args.find((arg) => arg.startsWith("-"));
  if (flag !== undefined) {
    throw unknownName("flag", flag, flagsOf(command), `bonne-garde ${command} --help`);
  }
}

/** For the commands that take no positional argument: whatever is left is wrong. */
function refuseLeftovers(command: string, args: readonly string[]): void {
  refuseUnknownFlag(command, args);
  if (args.length > 0) {
    throw new CliError(`Unexpected argument: ${args.join(" ")}`, {
      fix: `Usage: bonne-garde ${command} --help`,
    });
  }
}

/** Every failure ends here, in one shape, with the exit code it always had. */
export async function runCli(argv: string[]): Promise<number> {
  try {
    return await dispatch(argv);
  } catch (error) {
    console.error(errorText(error));
    return 1;
  }
}

async function dispatch(argv: string[]): Promise<number> {
  const [command, ...rest] = argv;
  if (command === "--version") {
    console.log(cliVersion());
    return 0;
  }
  // `--help` asks for the usage whatever the command: never a directory to create or an item to add.
  if (!command || [command, ...rest].some((arg) => arg === "-h" || arg === "--help")) {
    console.log((command && commandHelp(command)) || usage());
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
    refuseLeftovers("list", args);
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
    refuseUnknownFlag("search", args);
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
    refuseUnknownFlag("view", args);
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
    // --yes selects option defaults and never prompts. `add` has no prompt at all, so it
    // is accepted and changes nothing: options always resolve from their defaults.
    takeFlag(args, "--yes");
    const source = takeOption(args, "--source");
    if (takeOption(args, "--set") !== undefined) {
      throw new Error(
        "--set is not supported yet: options resolve from their defaults, and it is not defined which module a key addresses when several are named",
      );
    }
    // JSON on stdout for an agent, a pipe, or --json; a summary for a person at a terminal.
    const json = takeFlag(args, "--json") || process.stdout.isTTY !== true;
    refuseUnknownFlag("add", args);
    if (args.length === 0) {
      throw new Error("add requires at least one item or module");
    }
    // `--force` does not reach a module the call plans again without naming it: say which call does.
    const forceHint = (error: unknown): never => {
      if (error instanceof ApplyError && error.nameToForce.length > 0) {
        const { nameToForce } = error;
        throw new Error(
          `${error.message}\nname ${nameToForce.join(" and ")} in the same call, so that --force reaches ${nameToForce.length === 1 ? "it" : "them"}:\n  ${addNamingCommand(rest, nameToForce)}`,
        );
      }
      throw error;
    };
    if (!json) {
      clack.intro(styleText("inverse", " bonne-garde add "));
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
            }).catch(forceHint),
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
        if (outcome.installMissing !== null) {
          clack.cancel(missingPackageManager(outcome.installMissing));
          return 1;
        }
        clack.outro(dryRun ? "Nothing written: --dry-run." : "En garde.");
        return 0;
      } catch (error) {
        clack.cancel(clackErrorText(error));
        return 1;
      }
    }
    const outcome = await addItems({
      items: args,
      source,
      dryRun,
      force,
      install: !noInstall,
    }).catch(forceHint);
    const { plan, modulePlans, result, staged, reselected } = outcome;
    const { failedPatches, stagedAt } = reportAdd(outcome, dryRun);
    console.log(
      JSON.stringify(
        {
          dryRun,
          items: plan.items.map((i) => i.name),
          // The dependencies an item adds to the package.json its files land in: a patch each, owned by the item.
          itemPatches: result.patches
            .filter((patch) => plan.items.some((item) => item.name === patch.module))
            .map(({ module, ...patch }) => ({ item: module, ...patch })),
          // Modules of `modules` that this call did not name, planned again on another variant.
          reselected: reselected.map(({ ref, ...variants }) => ({
            module: `${ref.category}/${ref.id}`,
            ...variants,
          })),
          modules: modulePlans.map((module) => ({
            module: module.key,
            variant: module.variant,
            options: module.options,
            files: [...module.files, ...module.binaries].map((file) => file.target).sort(),
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
    if (outcome.installMissing !== null) {
      console.error(missingPackageManager(outcome.installMissing));
      return 1;
    }
    return 0;
  }

  if (command === "remove" || command === "replace") {
    throw new Error(`bonne-garde ${command} is not supported yet`);
  }

  if (command === "record") {
    const args = [...rest];
    const reason = takeOption(args, "--skip");
    refuseUnknownFlag("record", args);
    const id = args.shift();
    if (!id) {
      throw new Error("record requires an intention id");
    }
    refuseLeftovers("record", args);
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
        `bonne-garde: ${id} is not staged under .bg/; recorded anyway (the scratch root is disposable).`,
      );
    }
    for (const path of notFiles) {
      console.error(
        `bonne-garde: ${path} is not a file of the project, so ${id} did not mark it as edited by it.`,
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
    refuseLeftovers("doctor", args);
    // The JSON report has a verdict for a missing `bg.json` that agents read; a person gets the plain error.
    if (!json && !existsSync(join(process.cwd(), "bg.json"))) {
      throw notAProject(process.cwd());
    }
    const doctor = await runDoctor(process.cwd());
    console.log(
      json
        ? JSON.stringify(doctor, null, 2)
        : process.stdout.isTTY === true
          ? renderDoctor(doctor)
          : formatDoctor(doctor),
    );
    return doctorExitCode(doctor, strict);
  }

  if (command === "intentions") {
    const [sub, ...restArgs] = rest;
    if (sub !== "lint") {
      throw new CliError(`Unknown intentions subcommand: ${sub ?? "(missing)"}`, {
        fix: "Usage: bonne-garde intentions --help",
      });
    }
    const args = [...restArgs];
    const dirOpt = takeOption(args, "--dir");
    const registryOpt = takeOption(args, "--registry");
    refuseUnknownFlag("intentions", args);
    const dir = dirOpt ?? migrationsDir();
    if (!dir) {
      throw new Error("migrations directory not found (pass --dir)");
    }
    const registry = registryOpt ?? registryDir();
    if (!registry) {
      throw new Error("registry directory not found (pass --registry)");
    }
    // One linter for both producers: the release migrations, then the intentions of modules.
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

  throw unknownName("command", command, COMMANDS, "bonne-garde --help");
}
