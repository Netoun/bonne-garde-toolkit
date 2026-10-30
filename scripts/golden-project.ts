#!/usr/bin/env bun
/**
 * The golden project: what a consumer does, end to end, in a fresh directory.
 *
 *   bg create → bg add → bun install → typecheck → test → build → bg doctor --strict
 *   → bun run check → the `checks` of every installed module
 *
 * Any non-zero exit fails the run and names the phase. It needs a real `bun install` against npm,
 * so it is not part of `verify`; CI runs it as its own step.
 *
 * The CLI under test is the packed one (`bun run pack:cli`), driven as a subprocess so argv
 * parsing is exercised. It runs from a copy outside the repo: the packed `paths.ts` still walks up
 * to find the repo root, and `templateBaseDir()` falls back to the repo's `templates/base`, so in
 * place under `dist/` a pack that dropped its `templates/` would still pass. From a copy under the
 * temp directory, `bg create` can only use what the pack carries.
 *
 * Usage:
 *   bun run golden
 *   bun scripts/golden-project.ts
 */

import { cp, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const PACKED_CLI = join(ROOT, "dist/npm/create-bonne-garde");
const BUN = "bun";

/**
 * Items `bg list` shows that stay out of the golden project, each with its reason. An entry for an
 * item the registry no longer lists fails the run, so this list cannot go stale. Empty on purpose:
 * every item the registry ships is installed, and the test pins that.
 */
export const EXCLUDED: Readonly<Record<string, string>> = {};

export type Excluded = { name: string; reason: string };

/** The item names to `bg add`, read from `bg list` output (`name<TAB>type<TAB>description`). */
export function selectItems(
  listing: string,
  exclusions: Readonly<Record<string, string>>,
): { items: string[]; excluded: Excluded[] } {
  const listed = listing
    .split("\n")
    .map((line) => (line.split("\t")[0] ?? "").trim())
    .filter((name) => name.length > 0);

  const stale = Object.keys(exclusions).filter((name) => !listed.includes(name));
  if (stale.length > 0) {
    throw new Error(`excluded but not listed by the registry: ${stale.join(", ")}`);
  }

  const items = listed.filter((name) => !Object.hasOwn(exclusions, name));
  if (items.length === 0) {
    throw new Error("bg list left no items to install");
  }

  return {
    items,
    excluded: listed
      .filter((name) => Object.hasOwn(exclusions, name))
      .map((name) => ({ name, reason: exclusions[name] ?? "" })),
  };
}

/**
 * The modules golden installs with the items, as `<category>/<id>`, in one `bg add`. An explicit
 * list and not "every module `bg list` shows", because `provider` admits one module: installing
 * them all would fail on cardinality. A module that is in neither this list nor `EXCLUDED_MODULES`
 * fails the run, so a new module is a decision made here and not a silent gap.
 */
export const MODULES: readonly string[] = ["tooling/vite-plus"];

/**
 * Modules `bg list` shows that stay out of the golden project, each with its reason. An entry for
 * a module the registry no longer lists fails the run, as for `EXCLUDED`.
 */
export const EXCLUDED_MODULES: Readonly<Record<string, string>> = {
  "provider/cloudflare":
    "it ships apps/api/wrangler.jsonc, which item api-elysia ships too, and add refuses to overwrite a file it did not write without --force; stage 3 moves the file into api/elysia",
  "provider/dockerfile":
    "a project has one provider; stage 3 installs cloudflare and covers this one in a second run through `docker build`",
};

/**
 * The module ids to `bg add`, read from the `module` lines of `bg list` output
 * (`<category>/<id><TAB>module<TAB>description`). `installed` is what golden installs, in that order;
 * every other listed module must be in `exclusions`.
 */
export function selectModules(
  listing: string,
  installed: readonly string[],
  exclusions: Readonly<Record<string, string>>,
): { modules: string[]; excluded: Excluded[] } {
  const listed = listing
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([, type]) => type?.trim() === "module")
    .map(([name]) => (name ?? "").trim())
    .filter((name) => name.length > 0);

  const both = installed.filter((name) => Object.hasOwn(exclusions, name));
  if (both.length > 0) {
    throw new Error(`${both.join(", ")} is both installed and excluded`);
  }
  const stale = [...installed, ...Object.keys(exclusions)].filter((name) => !listed.includes(name));
  if (stale.length > 0) {
    throw new Error(`named but not listed by the registry: ${stale.join(", ")}`);
  }
  const undecided = listed.filter(
    (name) => !installed.includes(name) && !Object.hasOwn(exclusions, name),
  );
  if (undecided.length > 0) {
    throw new Error(
      `${undecided.join(", ")} listed by the registry, neither installed nor excluded: install it (MODULES) or exclude it with a reason (EXCLUDED_MODULES)`,
    );
  }
  if (installed.length === 0) {
    throw new Error("no modules to install");
  }

  return {
    modules: [...installed],
    excluded: listed
      .filter((name) => Object.hasOwn(exclusions, name))
      .map((name) => ({ name, reason: exclusions[name] ?? "" })),
  };
}

/** A module `bg add` reported, with the commands it declares to validate itself (spec 050 step 15). */
export type AddedModule = { module: string; checks: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

/**
 * The modules in the JSON `bg add` prints, which is where the packed CLI says what it installed
 * and what each module checks: `add` prints those commands and does not run them. Fails when a
 * module in `expected` is not among them.
 */
export function readAddedModules(stdout: string, expected: readonly string[]): AddedModule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bg add did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.modules)) {
    throw new Error("bg add printed no `modules` array");
  }
  const added = parsed.modules.map((entry: unknown): AddedModule => {
    if (!isRecord(entry) || typeof entry.module !== "string") {
      throw new Error("bg add printed a module with no `module` key");
    }
    const checks = entry.checks ?? [];
    if (!isStringArray(checks)) {
      throw new Error(`bg add printed \`checks\` of ${entry.module} that is not a list of strings`);
    }
    return { module: entry.module, checks };
  });
  const missing = expected.filter((name) => !added.some(({ module }) => module === name));
  if (missing.length > 0) {
    throw new Error(`bg add did not report ${missing.join(", ")}`);
  }
  return added;
}

type Timing = { phase: string; ms: number };

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

async function run(argv: string[], cwd: string): Promise<void> {
  const proc = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
}

async function capture(argv: string[], cwd: string): Promise<string> {
  const proc = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "pipe", stderr: "inherit" });
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
  return stdout;
}

async function phase<T>(timings: Timing[], name: string, body: () => Promise<T>): Promise<T> {
  console.log(`\n==> golden: ${name}`);
  const start = performance.now();
  try {
    return await body();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`phase "${name}" failed: ${reason}`);
  } finally {
    timings.push({ phase: name, ms: performance.now() - start });
  }
}

async function golden(work: string, timings: Timing[]): Promise<void> {
  const cli = join(work, "cli");
  const bg = (...args: string[]) => [BUN, join(cli, "src/bin.ts"), ...args];
  const registry = `local:${join(ROOT, "registry")}`;
  const project = join(work, "golden-app");

  await phase(timings, "pack", async () => {
    await run([BUN, "run", "pack:cli"], ROOT);
    await cp(PACKED_CLI, cli, { recursive: true });
  });

  const { items, modules, excluded } = await phase(timings, "list", async () => {
    const fromItems = selectItems(
      await capture(bg("list", "--items", "--source", registry), work),
      EXCLUDED,
    );
    const fromModules = selectModules(
      await capture(bg("list", "--source", registry), work),
      MODULES,
      EXCLUDED_MODULES,
    );
    return {
      items: fromItems.items,
      modules: fromModules.modules,
      excluded: [...fromItems.excluded, ...fromModules.excluded],
    };
  });
  for (const { name, reason } of excluded) {
    console.log(`golden: leaving out ${name}: ${reason}`);
  }

  await phase(timings, "create", () =>
    run(bg("create", project, "--yes", "--no-git", "--no-install", "--registry", registry), work),
  );
  const added = await phase(timings, "add", async () => {
    const stdout = await capture(bg("add", ...modules, ...items, "--yes", "--no-install"), project);
    process.stdout.write(stdout);
    return readAddedModules(stdout, modules);
  });
  await phase(timings, "install", () => run([BUN, "install"], project));
  await phase(timings, "typecheck", () => run([BUN, "run", "typecheck"], project));
  await phase(timings, "test", () => run([BUN, "run", "test"], project));
  await phase(timings, "build", () => run([BUN, "run", "build"], project));
  await phase(timings, "doctor", () => run(bg("doctor", "--strict"), project));
  await phase(timings, "check", () => run([BUN, "run", "check"], project));
  for (const { module, checks } of added.filter(({ checks }) => checks.length > 0)) {
    await phase(timings, `checks:${module}`, async () => {
      for (const command of checks) {
        await run(["sh", "-c", command], project);
      }
    });
  }
}

async function main(): Promise<number> {
  const work = await mkdtemp(join(tmpdir(), "bg-golden-"));
  const timings: Timing[] = [];
  const start = performance.now();
  let failure: unknown;

  try {
    await golden(work, timings);
  } catch (error) {
    failure = error;
  }

  console.log("\ngolden: phase timings");
  const width = Math.max(10, ...timings.map(({ phase: name }) => name.length));
  for (const { phase: name, ms } of timings) {
    console.log(`  ${name.padEnd(width)} ${seconds(ms)}`);
  }
  console.log(`  ${"total".padEnd(width)} ${seconds(performance.now() - start)}`);

  if (failure !== undefined) {
    const reason = failure instanceof Error ? failure.message : String(failure);
    console.error(`\ngolden: FAILED, ${reason}\ngolden: project kept at ${work}`);
    return 1;
  }
  await rm(work, { recursive: true, force: true });
  console.log("golden: ok");
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}
