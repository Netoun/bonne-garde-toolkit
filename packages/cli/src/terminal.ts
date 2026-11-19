/**
 * What a person sees on a terminal: the logo, the questions (clack), a spinner over each slow step,
 * what is left to do and what to run next. Without a terminal the CLI prints plain lines instead
 * (`report.ts`), which agents and scripts read; nothing here decides anything.
 */
import { styleText } from "node:util";
import * as clack from "@clack/prompts";
import { cliRunner } from "@bonne-garde/schema";
import type { AddOutcome } from "./add";
import type { Choice, Prompter } from "./choices";
import { manifestMigrationNotice } from "./report";
import type { PackageManager } from "./package-manager";

/**
 * Whether `stream` gets colour: a terminal, and `NO_COLOR` unset or empty (no-color.org). Not
 * `styleText`'s own check: under Bun `FORCE_COLOR=1` (set by CI) paints a pipe too, and `list` is
 * parsed by `scripts/golden-project.ts`, so a pipe must stay plain whatever the environment says.
 */
export function colorEnabled(
  stream: { isTTY?: boolean } = process.stdout,
  env: Record<string, string | undefined> = process.env,
): boolean {
  return stream.isTTY === true && (env.NO_COLOR === undefined || env.NO_COLOR === "");
}

/** `paint(format, text)` is `text` styled when `color` is on, and `text` itself when it is off. */
export function painter(color: boolean) {
  return (format: Parameters<typeof styleText>[0], text: string): string =>
    color ? styleText(format, text, { validateStream: false }) : text;
}

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

/** What `bonne-garde add` did, on a terminal: per module and item, then what is left to the user. */
export function showAdd(outcome: AddOutcome, dryRun: boolean, pm: PackageManager | null): void {
  const { modulePlans, plan, result, staged, migratedFrom } = outcome;
  const dim = (text: string) => styleText("dim", text);
  if (migratedFrom !== null) {
    clack.log.info(manifestMigrationNotice(dryRun).replace(/^bonne-garde: /, ""));
  }
  for (const module of modulePlans) {
    const patches = result.patches.filter((patch) => patch.module === module.key);
    const applied = patches.filter((patch) => patch.status === "applied").length;
    const parts = [
      `${module.files.length} file${module.files.length === 1 ? "" : "s"}`,
      ...(patches.length > 0 ? [`${applied}/${patches.length} patches applied`] : []),
      ...(module.workspace ? [module.workspace] : []),
    ];
    clack.log.success(`${module.key} ${dim(`(${module.variant})`)}  ${dim(parts.join(" · "))}`);
  }
  if (plan.items.length > 0) {
    clack.log.success(`${plan.items.map((item) => item.name).join(", ")} ${dim("(items)")}`);
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
    clack.note(
      [
        ...intentions.map(({ id }) => `• ${id}`),
        "",
        `Hand ${staged.session} to your coding agent: it applies each one,`,
        `then ${cliRunner()} record <id> (or ${cliRunner()} record <id> --skip "<reason>").`,
      ].join("\n"),
      `${intentions.length} intention${intentions.length === 1 ? "" : "s"} to apply`,
    );
  }
  const checks = modulePlans.filter(({ checks }) => checks.length > 0);
  if (checks.length > 0 && !dryRun) {
    const width = Math.max(...checks.map(({ key }) => key.length));
    clack.note(
      checks
        .map(
          ({ key, checks }) =>
            `${dim(key.padEnd(width))}   ${styleText("cyan", runnableCheck(checks.join(" && "), pm))}`,
        )
        .join("\n"),
      intentions.length > 0 ? "Checks, once the intentions are applied" : "Checks to run",
    );
  }
}
