/**
 * What a person sees on a terminal: the logo, the questions (clack), a spinner over each slow step,
 * what is left to do and what to run next. Without a terminal the CLI prints plain lines instead
 * (`report.ts`), which agents and scripts read; nothing here decides anything.
 */
import { styleText } from "node:util";
import * as clack from "@clack/prompts";
import { cliRunner } from "@bonne-garde/schema";
import type { AddOutcome, AddPhase, AddPhaseRunner, AddPhaseValues } from "./add";
import { packagesOf } from "./add";
import { CliError } from "./errors";
import type { Choice, Prompter } from "./choices";
import { manifestMigrationNotice } from "./report";
import type { PackageManager } from "./package-manager";

/** Ctrl+C on a question: the command stops, and nothing was written yet. */
export class Cancelled extends Error {
  constructor() {
    super("cancelled");
  }
}

/** The guard of a sword, small: blade, cross-guard, grip and pommel, and the name beside it. */
export function logo(subtitle: string): string {
  const steel = (text: string) => styleText("gray", text);
  const guard = (text: string) => styleText(["bold", "yellow"], text);
  return [
    `      ${steel("╽")}`,
    `  ${guard("◆━━━╋━━━◆")}   ${styleText("bold", "Bonne Garde")}`,
    `      ${guard("┃")}       ${styleText("dim", subtitle)}`,
    `      ${guard("◉")}`,
  ].join("\n");
}

/** The questions of `create`, as clack asks them: arrows to move, space to pick, enter to confirm. */
export function terminalPrompter(): Prompter {
  const options = (choices: readonly Choice<string>[]) =>
    choices.map(({ value, label, hint }) => ({ value, label, hint }));
  // clack answers with the value it was shown; the choice it names is the typed one.
  const pick = <T extends string>(choices: readonly Choice<T>[], value: string): T => {
    const chosen = choices.find((choice) => choice.value === value);
    if (chosen === undefined) {
      throw new Error(`${value} is not one of the answers offered`);
    }
    return chosen.value;
  };
  return {
    async one(message, choices, initial) {
      const answer = await clack.select<string>({
        message,
        options: options(choices),
        initialValue: initial,
      });
      if (clack.isCancel(answer)) {
        throw new Cancelled();
      }
      return pick(choices, answer);
    },
    async many(message, choices) {
      const answer = await clack.multiselect<string>({
        message,
        options: options(choices),
        required: false,
      });
      if (clack.isCancel(answer)) {
        throw new Cancelled();
      }
      return answer.map((value) => pick(choices, value));
    },
    warn: (message) => clack.log.warn(message),
  };
}

/** A slow step under a spinner: its label while it runs, `done` once it has, the error if it fails. */
export async function step<T>(
  label: string,
  run: () => Promise<T>,
  done: (value: T) => string,
): Promise<T> {
  const spinner = clack.spinner();
  spinner.start(label);
  try {
    const value = await run();
    spinner.stop(done(value));
    return value;
  } catch (error) {
    spinner.error(`${label}: failed`);
    throw error;
  }
}

export type NextStep = { run: string; why: string };

/**
 * What to do once `create` is done, in order: enter the project, install if it was skipped, hand the
 * pending intentions to an agent, then the scripts the project has.
 */
export function nextSteps(options: {
  dir: string;
  pm: PackageManager;
  installed: boolean;
  session: { path: string; pending: number } | null;
  scripts: readonly string[];
}): NextStep[] {
  const { dir, pm, installed, session, scripts } = options;
  const run = (script: string) => `${pm} run ${script}`;
  const steps: NextStep[] = [];
  if (dir !== ".") {
    steps.push({ run: `cd ${dir}`, why: "" });
  }
  if (!installed) {
    steps.push({ run: `${pm} install`, why: "--no-install skipped it" });
  }
  if (session !== null) {
    const what = session.pending === 1 ? "1 intention" : `${session.pending} intentions`;
    steps.push({ run: `read ${session.path}`, why: `${what} for your coding agent to apply` });
  }
  if (scripts.includes("dev")) {
    steps.push({ run: run("dev"), why: "every app, side by side" });
  }
  if (scripts.includes("dev:portless")) {
    steps.push({ run: run("dev:portless"), why: "the same, on named HTTPS URLs" });
  }
  if (scripts.includes("test")) {
    steps.push({ run: run("test"), why: "every package's tests" });
  }
  return steps;
}

/** Steps as a note: the commands aligned, what each does dimmed beside it. */
export function renderSteps(steps: readonly NextStep[]): string {
  const width = Math.max(...steps.map(({ run }) => run.length));
  return steps
    .map(({ run, why }) =>
      why === ""
        ? styleText("cyan", run)
        : `${styleText("cyan", run.padEnd(width))}   ${styleText("dim", why)}`,
    )
    .join("\n");
}

export { clack };

/**
 * A module's check as a person types it in their shell: each command but `cd` through the package
 * manager, which finds the project's bins (`vp`, `tsc`) as a check expects them on PATH (035).
 */
export function runnableCheck(check: string, pm: PackageManager | null): string {
  if (pm === null) {
    return check;
  }
  const exec = pm === "bun" ? "bunx" : "pnpm exec";
  return check
    .split(/( && |; )/)
    .map((part, index) =>
      index % 2 === 1 || part.startsWith("cd ") || part.trim() === "" ? part : `${exec} ${part}`,
    )
    .join("");
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const bold = (text: string) => styleText("bold", text);
const dim = (text: string) => styleText("dim", text);
const done = (text: string) => clack.log.message(text, { symbol: styleText("green", "●") });

/** Lines printed as they are, outside any clack box: what a person copies has no border or prefix. */
function plainBlock(title: string, lines: readonly string[]): void {
  process.stdout.write(`\n${bold(title)}\n${lines.map((line) => `  ${line}`).join("\n")}\n`);
}

function commonDir(files: readonly string[]): string {
  const dirs = files.map((file) => file.split("/").slice(0, -1));
  let common = dirs[0] ?? [];
  for (const dir of dirs) {
    let length = 0;
    while (length < common.length && common[length] === dir[length]) {
      length++;
    }
    common = common.slice(0, length);
  }
  return common.join("/");
}

/** The first two files, then how many more and the directory they share. */
function fileLines(files: readonly string[]): string[] {
  const shown = files.slice(0, 2).map((file) => `  ${dim(file)}`);
  const rest = files.slice(2);
  if (rest.length === 0) {
    return shown;
  }
  const shared = commonDir(rest);
  return [...shown, `  ${dim(`… ${rest.length} more${shared === "" ? "" : ` under ${shared}`}`)}`];
}

const quoted = (names: readonly string[]) => {
  const shown = names.slice(0, 3).join(", ");
  return names.length > 3 ? `${shown} and ${names.length - 3} more` : shown;
};

/**
 * `addItems` one step at a time under a spinner each, as `create` shows its own: what a step did
 * once it has, and the step by name when it fails.
 */
export function addPhases(
  names: readonly string[],
  dryRun: boolean,
  pm: PackageManager | null,
): AddPhaseRunner {
  let packages = 0;
  const started: Partial<Record<AddPhase, number>> = {};
  const labels: Record<AddPhase, () => string> = {
    plan: () => `Planning ${quoted(names)}`,
    write: () => (dryRun ? "Checking what would be written" : "Writing files"),
    install: () => `Installing ${plural(packages, "package")}${pm === null ? "" : ` with ${pm}`}`,
  };
  const outcomes: { [P in AddPhase]: (value: AddPhaseValues[P]) => string } = {
    plan: (planned) => {
      const { plan, modulePlans } = planned;
      packages = packagesOf(planned).length;
      const counts = [
        ...(modulePlans.length > 0 ? [plural(modulePlans.length, "module")] : []),
        ...(plan.items.length > 0 ? [plural(plan.items.length, "item")] : []),
      ];
      return `Planned ${quoted(names)} (${counts.join(", ")})`;
    },
    write: ({ written, patches }) => {
      const applied = patches.filter(({ status }) => status === "applied").length;
      const patched =
        applied > 0 ? `, ${dryRun ? "apply" : "applied"} ${plural(applied, "patch")}` : "";
      return dryRun
        ? `Dry run: would write ${plural(written.length, "file")}${patched}`
        : `Wrote ${plural(written.length, "file")}${patched}`;
    },
    install: () =>
      `Installed${pm === null ? "" : ` with ${pm}`} in ${Math.round((Date.now() - (started.install ?? Date.now())) / 1000)}s`,
  };
  return async (name, run) => {
    const label = labels[name]();
    const spinner = clack.spinner();
    spinner.start(label);
    started[name] = Date.now();
    try {
      const value = await run();
      if (name === "install" && "missing" in value && value.missing) {
        spinner.error(`${label}: failed`);
      } else {
        spinner.stop(outcomes[name](value));
      }
      return value;
    } catch (error) {
      spinner.error(`${label}: failed`);
      if (name !== "install" || !(error instanceof Error)) {
        throw error;
      }
      throw new CliError(`${label} failed`, { cause: error.message });
    }
  };
}

/** What `bonne-garde add` did, on a terminal: per name what it brought, then what is left to the user. */
export function showAdd(outcome: AddOutcome, dryRun: boolean, pm: PackageManager | null): void {
  const { modulePlans, plan, result, staged, migratedFrom, unchanged, requestedItems } = outcome;
  if (migratedFrom !== null) {
    clack.log.info(manifestMigrationNotice(dryRun).replace(/^bonne-garde: /, ""));
  }
  const filesOf = (owners: readonly string[]) =>
    result.written.filter((path) => owners.includes(result.manifest.files[path]?.owner ?? ""));
  const appliedBy = (owner: string) =>
    result.patches.filter((patch) => patch.module === owner && patch.status === "applied").length;
  const summary = (files: readonly string[], patches: number, extra: readonly string[]) =>
    [
      dryRun ? `would write ${plural(files.length, "file")}` : plural(files.length, "file"),
      ...(patches > 0
        ? [
            dryRun
              ? `would apply ${plural(patches, "patch")}`
              : `${plural(patches, "patch")} applied`,
          ]
        : []),
      ...extra,
    ].join(" · ");

  for (const module of modulePlans) {
    if (unchanged.includes(module.key)) {
      done(`${bold(module.key)} is already installed: nothing to do`);
      continue;
    }
    const files = filesOf([module.key]);
    const extra = module.workspace ? [module.workspace] : [];
    clack.log.success(
      [
        `${bold(module.key)} ${dim(`(${module.variant})`)}  ${dim(summary(files, appliedBy(module.key), extra))}`,
        ...fileLines(files),
      ].join("\n"),
    );
  }
  // What an item brings along stays with the name the user typed: the items it needs are listed once.
  const needed = plan.items
    .map(({ name }) => name)
    .filter((name) => !requestedItems.includes(name));
  requestedItems.forEach((name, index) => {
    if (unchanged.includes(name)) {
      done(`${bold(name)} is already installed: nothing to do`);
      return;
    }
    const needs = index === 0 ? needed : [];
    const files = filesOf([name, ...needs]);
    const brings = needs.length > 0 ? `+ ${needs.length} it needs: ${needs.join(", ")}` : "";
    const head = dryRun ? [`would write ${plural(files.length, "file")}`] : [];
    clack.log.success(
      [
        `${bold(name)}  ${dim(
          brings === "" ? summary(files, appliedBy(name), []) : [...head, brings].join(" · "),
        )}`,
        ...fileLines(files),
      ].join("\n"),
    );
  });
  const nothingNew =
    modulePlans.every(({ key }) => unchanged.includes(key)) &&
    requestedItems.every((name) => unchanged.includes(name));
  if (outcome.packages.length > 0 && !nothingNew) {
    const shown = outcome.packages.slice(0, 8).join(", ");
    const more = outcome.packages.length - 8;
    const installed = outcome.installedWith !== null && outcome.installMissing === null;
    done(
      `${installed ? "Installed" : dryRun ? "Would install" : "To install"}: ${shown}${more > 0 ? ` and ${more} more` : ""}`,
    );
  }
  for (const { ref, from, to } of outcome.reselected) {
    clack.log.info(`${ref.category}/${ref.id} planned again: variant ${from} → ${to}`);
  }
  for (const { path, from, by } of result.tookOver) {
    clack.log.info(`${path} was ${from}'s, it is ${by}'s now`);
  }
  const env = result.env?.added ?? [];
  if (env.length > 0) {
    clack.log.info(
      `New in ${result.env?.file ?? ".env.example"}: ${env.map(({ name }) => name).join(", ")}`,
    );
  }
  for (const { type, file, module, reason, intention } of result.patches.filter(
    (patch) => patch.status === "failed",
  )) {
    clack.log.warn(
      `${module}: ${type} on ${file} could not apply (${reason}); ` +
        (intention === undefined ? "make the edit by hand" : `it is the intention ${intention}`),
    );
  }
  const intentions = [...result.pending, ...result.authored];
  if (staged !== null && intentions.length > 0) {
    plainBlock(`${plural(intentions.length, "intention")} to apply`, [
      ...intentions.map(({ id }) => `• ${id}`),
      `Hand ${staged.session} to your coding agent. Once it applied one, run:`,
      `  ${cliRunner()} record <id>`,
      `  ${cliRunner()} record <id> --skip "<reason>"`,
    ]);
  }
  const checks = modulePlans.filter(({ checks }) => checks.length > 0);
  if (checks.length > 0 && !dryRun) {
    plainBlock(
      intentions.length > 0 ? "Checks, once the intentions are applied" : "Checks to run",
      checks.flatMap(({ key, checks }) => [
        dim(key),
        `  ${styleText("cyan", runnableCheck(checks.join(" && "), pm))}`,
      ]),
    );
  }
}
