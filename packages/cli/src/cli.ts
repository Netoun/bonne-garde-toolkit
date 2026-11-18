import { createInterface } from "node:readline/promises";
import type { IntentionOutcome } from "@bonne-garde/schema";
import { addItems, namesChecker, searchItems, viewItem, type AddOutcome } from "./add";
import { checksNotice } from "./checks-notice";
import { createProject } from "./create";
import { doctorExitCode, formatDoctor, runDoctor } from "./doctor";
import { lintIntentions } from "./intentions/lint";
import { lintModuleIntentions } from "./intentions/lint-modules";
import { listRegistry } from "./list";
import { invokingPackageManager, PACKAGE_MANAGERS } from "./package-manager";
import { recordIntentionOutcome } from "./record";
import {
  APPS,
  CANDIDATE_MODULES,
  FEATURES,
  namesFor,
  parseFlagList,
  PROVIDERS,
  resolveChoices,
  type Ask,
  type Choices,
} from "./choices";
import { defaultRegistrySource, migrationsDir, registryDir } from "./paths";

function usage(): string {
  return `bg — Bonne Garde CLI

Usage:
  bg create <dir> [--pm <name>] [--apps <a,b>] [--provider <name>] [--features <a,b>] [--yes]
                 [--no-git] [--no-install] [--scope @name] [--registry <source>]
      pm: ${PACKAGE_MANAGERS.join(", ")}; apps: ${APPS.join(", ")}; provider: ${PROVIDERS.join(", ")};
      features: ${FEATURES.join(", ")}
      what no flag gives is asked on a TTY without --yes; else the package manager create was started
      from (bun when it is neither), and no app: the base alone
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
  bg intentions lint [--dir <migrations-dir>] [--registry <registry-dir>]
      the release migrations, and the intentions each module ships under its intent/
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

/**
 * What an add left to the user, on stderr: `bg add`, and `bg create` for its template's add. Spec 060:
 * a failed patch never aborts the install and is never silent. It is a pending tier-3 intention
 * (050 steps 11 and 14), staged under .bg/add/ with the executor entry point.
 */
function reportAdd({ modulePlans, result, migratedFrom, staged }: AddOutcome, dryRun: boolean) {
  if (migratedFrom !== null) {
    console.error(manifestMigrationNotice(dryRun));
  }
  for (const { path, from, by } of result.tookOver) {
    console.error(`bg: ${path} was owned by ${from}; ${by} now owns it`);
  }
  const failedPatches = result.patches.filter((patch) => patch.status === "failed");
  const stagedAt = new Map((staged?.files ?? []).map(({ id, file }) => [id, file]));
  for (const { type, file, module, reason, intention } of failedPatches) {
    const where = intention === undefined ? undefined : stagedAt.get(intention);
    const resolved = intention !== undefined && !result.pending.some(({ id }) => id === intention);
    console.error(
      `bg: PATCH FAILED ${type} on ${file} (${module}): ${reason}. ` +
        (intention === undefined
          ? "Make the edit by hand."
          : resolved
            ? `Its intention ${intention} is already recorded in bg.json.`
            : `It is the pending intention ${intention}, ${where === undefined ? "dry run: nothing staged" : `staged in ${where}`}.`),
    );
  }
  const pendingCount = result.pending.length + result.authored.length;
  if (staged !== null) {
    console.error(
      `bg: ${pendingCount} pending intention${pendingCount === 1 ? "" : "s"}: ` +
        `read ${staged.session} and follow it (spec 065), then bg record <id> or bg record <id> --skip "<reason>".`,
    );
  }
  const notice = checksNotice(modulePlans, pendingCount);
  if (notice !== null) {
    console.error(notice);
  }
  return { failedPatches, stagedAt };
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
    const given: Partial<Choices> = {};
    const apps = takeOption(args, "--apps");
    if (apps !== undefined) {
      given.apps = parseFlagList("--apps", apps, APPS);
    }
    const pm = takeOption(args, "--pm");
    if (pm !== undefined) {
      const [one, ...more] = parseFlagList("--pm", pm, PACKAGE_MANAGERS);
      if (one === undefined || more.length > 0) {
        throw new Error(`--pm takes one of ${PACKAGE_MANAGERS.join(", ")}`);
      }
      given.pm = one;
    }
    const provider = takeOption(args, "--provider");
    if (provider !== undefined) {
      const [one, ...more] = parseFlagList("--provider", provider, PROVIDERS);
      if (one === undefined || more.length > 0) {
        throw new Error(`--provider takes one of ${PROVIDERS.join(", ")}`);
      }
      given.provider = one;
    }
    const features = takeOption(args, "--features");
    if (features !== undefined) {
      given.features = parseFlagList("--features", features, FEATURES);
    }
    const name = args[0];
    if (!name) {
      throw new Error("create requires a directory name");
    }
    // Only on a TTY, and closed before the install runs: an open interface holds stdin.
    const terminal =
      !yes && process.stdin.isTTY === true
        ? createInterface({ input: process.stdin, output: process.stdout })
        : null;
    const ask: Ask | null = terminal
      ? (question) => terminal.question(question).catch(() => null)
      : null;
    const source = registry ?? defaultRegistrySource();
    const choices = await resolveChoices({
      given,
      ask,
      defaultPm: invokingPackageManager() ?? "bun",
      loadCheck: () => namesChecker(source, process.cwd(), CANDIDATE_MODULES),
      say: (message) => console.error(message),
    }).finally(() => terminal?.close());
    const { modules, items } = namesFor(choices);
    const { target, added } = await createProject({
      name,
      scope,
      registry,
      git: !noGit,
      install: !noInstall,
      names: [...modules, ...items],
    });
    console.log(
      choices.provider === null
        ? `created ${target} with ${choices.pm}`
        : `created ${target} with ${choices.apps.join(", ")} on ${choices.provider}` +
            (choices.features.length > 0 ? `, and ${choices.features.join(", ")}` : "") +
            `, installed with ${choices.pm}`,
    );
    if (added !== null) {
      reportAdd(added, false);
    }
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
