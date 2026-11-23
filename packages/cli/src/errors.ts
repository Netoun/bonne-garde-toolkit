/**
 * One shape for every failure of the CLI: a title, the cause, the command that fixes it.
 * The words are the same with or without a terminal; only the colors need one.
 */
import { styleText } from "node:util";

export class CliError extends Error {
  readonly detail: string | undefined;
  readonly fix: string | undefined;

  constructor(title: string, { cause, fix }: { cause?: string; fix?: string } = {}) {
    super(title);
    this.detail = cause;
    this.fix = fix;
  }
}

export function notAProject(dir: string): CliError {
  return new CliError("Not a Bonne Garde project", {
    cause: `No bg.json in ${dir}.`,
    fix: "Create one: bonne-garde create <dir>",
  });
}

/** An unknown command or flag: what was typed, the nearest name if there is one, and where the full list is. */
export function unknownName(
  kind: "command" | "flag",
  typed: string,
  candidates: readonly string[],
  listedBy: string,
): CliError {
  const near = closest(typed, candidates);
  return new CliError(`Unknown ${kind}: ${typed}`, {
    ...(near === undefined ? {} : { cause: `Did you mean: ${near}?` }),
    fix: `All ${kind}s: ${listedBy}`,
  });
}

/** Optimal string alignment distance: insertions, deletions, substitutions and swapped neighbours. */
function distance(a: string, b: string): number {
  const rows = Array.from({ length: a.length + 1 }, (_, i) => [
    i,
    ...new Array<number>(b.length).fill(0),
  ]);
  for (let j = 1; j <= b.length; j++) {
    rows[0]![j] = j;
  }
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let best = Math.min(rows[i - 1]![j]! + 1, rows[i]![j - 1]! + 1, rows[i - 1]![j - 1]! + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        best = Math.min(best, rows[i - 2]![j - 2]! + 1);
      }
      rows[i]![j] = best;
    }
  }
  return rows[a.length]![b.length]!;
}

/** The candidate nearest to `typed`, or nothing when no one is near enough to be a typo of it. */
export function closest(typed: string, candidates: readonly string[]): string | undefined {
  const limit = Math.max(1, Math.ceil(typed.replace(/^-+/, "").length / 3));
  let best: { name: string; score: number } | undefined;
  for (const name of candidates) {
    const score = distance(typed, name);
    if (score <= limit && (best === undefined || score < best.score)) {
      best = { name, score };
    }
  }
  return best?.name;
}

/** The lines of an error: its title first, then the cause and the fix, indented. */
function errorLines(error: unknown): { title: string; rest: string[]; fix: string | undefined } {
  if (error instanceof CliError) {
    return {
      title: error.message,
      rest: error.detail === undefined ? [] : [`  ${error.detail}`],
      fix: error.fix,
    };
  }
  // A plain error's own lines stay as they are: some carry a command, indented to be copied.
  const [title = "", ...rest] = (error instanceof Error ? error.message : String(error)).split(
    "\n",
  );
  return { title, rest, fix: undefined };
}

/** Colors only where stderr is a terminal and NO_COLOR is not set: `styleText` checks both. */
function paint(format: "red" | "dim" | "bold", text: string): string {
  return styleText(format, text, { stream: process.stderr });
}

export function errorText(error: unknown): string {
  const { title, rest, fix } = errorLines(error);
  return [
    paint("red", paint("bold", `✖ ${title}`)),
    ...rest,
    ...(fix === undefined ? [] : [paint("dim", `  ${fix}`)]),
  ].join("\n");
}

/** The same split inside clack, whose `cancel` already draws the bar and colors the message red. */
export function clackErrorText(error: unknown): string {
  const { title, rest, fix } = errorLines(error);
  return [
    title,
    ...rest.map((line) => line.trimStart()),
    ...(fix === undefined ? [] : [paint("dim", fix)]),
  ].join("\n   ");
}
