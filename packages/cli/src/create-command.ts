/**
 * `bg create` (spec 040): the answers, then the project, then its install. On a terminal it is the
 * logo, clack's questions, a spinner per step and the next steps; elsewhere (a pipe, an agent, CI) the
 * plain lines `report.ts` prints, which do not change with the look.
 */
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { styleText } from "node:util";
import { namesChecker } from "./add";
import { takeFlag, takeOption } from "./args";
import {
  APPS,
  CANDIDATE_MODULES,
  type Choices,
  FEATURES,
  namesFor,
  parseFlagList,
  PROVIDERS,
  resolveChoices,
} from "./choices";
import { createProject } from "./create";
import { installDependencies, invokingPackageManager, PACKAGE_MANAGERS } from "./package-manager";
import { defaultRegistrySource } from "./paths";
import { reportAdd } from "./report";
import { Cancelled, clack, logo, nextSteps, renderSteps, step, terminalPrompter } from "./terminal";

function one<T extends string>(flag: string, value: string, allowed: readonly T[]): T {
  const [first, ...more] = parseFlagList(flag, value, allowed);
  if (first === undefined || more.length > 0) {
    throw new Error(`${flag} takes one of ${allowed.join(", ")}`);
  }
  return first;
}

/** What `create` prints when it is done, on one line: the plain output's, which tests and agents read. */
function createdLine(target: string, choices: Choices): string {
  return choices.provider === null
    ? `created ${target} with ${choices.pm}`
    : `created ${target} with ${choices.apps.join(", ")} on ${choices.provider}` +
        (choices.features.length > 0 ? `, and ${choices.features.join(", ")}` : "") +
        `, installed with ${choices.pm}`;
}

/** A registry source as a person reads it: a local path from here, or from ~ when it is not under here. */
function shownSource(source: string): string {
  if (!source.startsWith("local:")) {
    return source;
  }
  const path = source.slice("local:".length);
  const near = relative(process.cwd(), path);
  return `local:${near === "" ? "." : near.startsWith("..") ? path.replace(homedir(), "~") : near}`;
}

async function rootScripts(target: string): Promise<string[]> {
  const manifest: unknown = JSON.parse(await readFile(join(target, "package.json"), "utf8"));
  return typeof manifest === "object" &&
    manifest !== null &&
    "scripts" in manifest &&
    typeof manifest.scripts === "object" &&
    manifest.scripts !== null
    ? Object.keys(manifest.scripts)
    : [];
}

export async function createCommand(rest: readonly string[]): Promise<number> {
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
    given.pm = one("--pm", pm, PACKAGE_MANAGERS);
  }
  const provider = takeOption(args, "--provider");
  if (provider !== undefined) {
    given.provider = one("--provider", provider, PROVIDERS);
  }
  const features = takeOption(args, "--features");
  if (features !== undefined) {
    given.features = parseFlagList("--features", features, FEATURES);
  }
  const source = registry ?? defaultRegistrySource();
  const defaultPm = invokingPackageManager() ?? "bun";
  const create = (name: string, choices: Choices) => {
    const { modules, items } = namesFor(choices);
    return createProject({
      name,
      scope,
      registry,
      git: !noGit,
      install: false,
      names: [...modules, ...items],
    });
  };

  if (process.stdout.isTTY !== true) {
    const name = args[0];
    if (!name) {
      throw new Error("create requires a directory name");
    }
    const choices = await resolveChoices({
      given,
      prompter: null,
      defaultPm,
      loadCheck: () => namesChecker(source, process.cwd(), CANDIDATE_MODULES),
    });
    const { target, added } = await create(name, choices);
    if (!noInstall) {
      await installDependencies(target);
    }
    console.log(createdLine(target, choices));
    if (added !== null) {
      reportAdd(added, false);
    }
    return 0;
  }

  // On a terminal: questions only where stdin is one too and --yes did not waive them.
  const prompter = !yes && process.stdin.isTTY === true ? terminalPrompter() : null;
  try {
    let name = args[0];
    console.log(`\n${logo(name ? `a new project in ${name}` : "a new project")}\n`);
    clack.intro(styleText("inverse", " bg create "));
    if (!name) {
      if (prompter === null) {
        throw new Error("create requires a directory name");
      }
      const answer = await clack.text({
        message: "Where should the project go?",
        placeholder: "my-app",
        defaultValue: "my-app",
      });
      if (clack.isCancel(answer)) {
        throw new Cancelled();
      }
      name = answer;
    }
    const projectName = name;
    const choices = await resolveChoices({
      given,
      prompter,
      defaultPm,
      loadCheck: () =>
        step(
          "Reading the registry",
          () => namesChecker(source, process.cwd(), CANDIDATE_MODULES),
          () => `Registry read (${shownSource(source)})`,
        ),
    });
    const { target, added } = await step(
      `Creating ${projectName}`,
      () => create(projectName, choices),
      ({ added }) => {
        const modules = added?.modulePlans.length ?? 0;
        const items = added?.plan.items.length ?? 0;
        return `Created ${projectName}: ${modules} module${modules === 1 ? "" : "s"}${items > 0 ? `, ${items} item${items === 1 ? "" : "s"}` : ""}`;
      },
    );
    if (!noInstall) {
      const started = Date.now();
      await step(
        `Installing with ${choices.pm}`,
        () => installDependencies(target, { output: "capture" }),
        () => `Installed with ${choices.pm} in ${Math.round((Date.now() - started) / 1000)}s`,
      );
    }

    const failed = added?.result.patches.filter((patch) => patch.status === "failed") ?? [];
    for (const { type, file, module, reason } of failed) {
      clack.log.warn(
        `${module}: ${type} on ${file} could not apply (${reason}); it is an intention below`,
      );
    }
    const pending = (added?.result.pending.length ?? 0) + (added?.result.authored.length ?? 0);
    const session = added?.staged ? { path: added.staged.session, pending } : null;
    if (session !== null && added !== null) {
      const ids = [...added.result.pending, ...added.result.authored].map(({ id }) => `• ${id}`);
      clack.note(
        [
          ...ids,
          "",
          `Hand ${session.path} to your coding agent: it applies each one,`,
          'then bg record <id> (or bg record <id> --skip "<reason>").',
        ].join("\n"),
        `${pending} intention${pending === 1 ? "" : "s"} to apply`,
      );
    }
    clack.note(
      renderSteps(
        nextSteps({
          dir: relative(process.cwd(), target) || ".",
          pm: choices.pm,
          installed: !noInstall,
          session,
          scripts: await rootScripts(target),
        }),
      ),
      "Next steps",
    );
    clack.outro("En garde.");
    return 0;
  } catch (error) {
    if (error instanceof Cancelled) {
      clack.cancel("Cancelled: nothing was written.");
      return 130;
    }
    clack.cancel(error instanceof Error ? error.message : String(error));
    return 1;
  }
}
