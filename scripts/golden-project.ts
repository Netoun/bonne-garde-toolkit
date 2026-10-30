#!/usr/bin/env bun
/**
 * The golden project: what a consumer does, end to end, in a fresh directory.
 *
 *   bg create → bg add of a UI item, refused → bg add of every module and every item in one call
 *   → the same bg add again, which must skip every patch and change nothing → bun install
 *   → typecheck → test → build → bg doctor --strict → bun run check → the `checks` of every installed module
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
 * The project's npm scope. Registry files are authored for `@acme` and `add` rewrites the scope at
 * copy time, which moves line lengths and so where the formatter wraps. A scope of `@acme`'s length
 * could not show it, and the one `create` derives from the directory name (`@golden-app`) happened
 * to wrap like it. `@app` is shorter: it un-wraps what `@acme` had to wrap.
 */
export const SCOPE = "@app";

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
export const MODULES: readonly string[] = [
  "provider/cloudflare",
  "tooling/vite-plus",
  "config/branding",
  "ui/shadcn",
];

/** The item `refuse` tries with no ui module, and the module its refusal has to name. */
const REFUSED_ITEM = "button";
const REFUSED_MODULE = "ui/shadcn";

/**
 * Modules `bg list` shows that stay out of the golden project, each with its reason. An entry for
 * a module the registry no longer lists fails the run, as for `EXCLUDED`.
 */
export const EXCLUDED_MODULES: Readonly<Record<string, string>> = {
  "provider/dockerfile":
    "a project has one provider, and cloudflare is the one installed here; the api module's commit gives dockerfile a configuration of its own",
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

/**
 * The modules of `MODULES` whose variants declare a tier-2 patch, with the regions each one's patches
 * write. Golden checks that `bg add` reports exactly these as `applied` and, run again, as `skipped`:
 * a module that gains or loses a patch is a decision made here, as a module that is not installed is.
 */
export const PATCHED: Readonly<Record<string, readonly string[]>> = {
  "config/branding": ["scripts.gen:branding"],
};

/** One patch of a module, as `bg add` prints it (spec 060): its outcome and, per region, what it did. */
export type AddedPatch = {
  type: string;
  file: string;
  status: string;
  reason?: string;
  regions: { region: string; status: string }[];
};

/** A module `bg add` reported, with the commands it declares to validate itself (spec 050 step 15) and its patches. */
export type AddedModule = { module: string; checks: string[]; patches: AddedPatch[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

function readPatch(module: string, patch: unknown): AddedPatch {
  if (
    !isRecord(patch) ||
    typeof patch.type !== "string" ||
    typeof patch.file !== "string" ||
    typeof patch.status !== "string" ||
    !Array.isArray(patch.regions)
  ) {
    throw new Error(`bg add printed a patch of ${module} without type, file, status and regions`);
  }
  const regions = patch.regions.map((region: unknown) => {
    if (
      !isRecord(region) ||
      typeof region.region !== "string" ||
      typeof region.status !== "string"
    ) {
      throw new Error(`bg add printed a region of a patch of ${module} without region and status`);
    }
    return { region: region.region, status: region.status };
  });
  return {
    type: patch.type,
    file: patch.file,
    status: patch.status,
    ...(typeof patch.reason === "string" ? { reason: patch.reason } : {}),
    regions,
  };
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
    const patches = entry.patches ?? [];
    if (!Array.isArray(patches)) {
      throw new Error(`bg add printed \`patches\` of ${entry.module} that is not a list`);
    }
    const { module } = entry;
    return { module, checks, patches: patches.map((patch) => readPatch(module, patch)) };
  });
  const missing = expected.filter((name) => !added.some(({ module }) => module === name));
  if (missing.length > 0) {
    throw new Error(`bg add did not report ${missing.join(", ")}`);
  }
  return added;
}

/**
 * Spec 060: a failed patch is never silent, and a re-add finds every region present and equal.
 * Checks every patch `bg add` reported against `status`, and the regions of each module against
 * `expected`, which is where golden says which modules patch what.
 */
export function expectPatches(
  added: readonly AddedModule[],
  status: "applied" | "skipped",
  expected: Readonly<Record<string, readonly string[]>>,
): void {
  for (const { module, patches } of added) {
    for (const patch of patches) {
      if (patch.status === "failed") {
        throw new Error(
          `${module}: patch ${patch.type} on ${patch.file} failed: ${patch.reason ?? "no reason given"}`,
        );
      }
      if (patch.status !== status || patch.regions.some((region) => region.status !== status)) {
        throw new Error(
          `${module}: patch ${patch.type} on ${patch.file} was ${patch.status} (regions: ${patch.regions.map((region) => `${region.region} ${region.status}`).join(", ") || "none"}), expected ${status}`,
        );
      }
    }
    if (patches.length > 0 && !Object.hasOwn(expected, module)) {
      throw new Error(`${module} patches files but is not in PATCHED: say what golden should see`);
    }
  }
  for (const [module, regions] of Object.entries(expected)) {
    const reported = added
      .filter((entry) => entry.module === module)
      .flatMap(({ patches }) =>
        patches.flatMap((patch) => patch.regions.map(({ region }) => region)),
      );
    if (JSON.stringify([...reported].sort()) !== JSON.stringify([...regions].sort())) {
      throw new Error(
        `${module} reported regions [${reported.join(", ")}], golden expects [${regions.join(", ")}]`,
      );
    }
  }
}

/**
 * The regions `bg add` reported must be in `bg.json` under `regions`, owned by the module that
 * reported them: the printed outcome and the recorded state are two things, and this ties them.
 */
export function expectRegionsRecorded(manifest: unknown, added: readonly AddedModule[]): void {
  const regions = isRecord(manifest) && isRecord(manifest.regions) ? manifest.regions : null;
  if (regions === null) {
    throw new Error("bg.json has no `regions` object");
  }
  for (const { module, patches } of added) {
    for (const { file, regions: reported } of patches) {
      const owned = regions[file];
      for (const { region } of reported) {
        const owner = isRecord(owned) ? owned[region] : undefined;
        if (owner !== module) {
          throw new Error(
            `bg.json records ${region} of ${file} for ${String(owner)}, and bg add reported it for ${module}`,
          );
        }
      }
    }
  }
}

/**
 * What differs between two snapshots of a project, as `<path> changed|added|removed`. `bg.json` is
 * compared without `installedAt`, the one thing a re-add moves in it. Any other change in it is
 * reported, the recorded status of a patch included.
 */
export function diffTrees(
  before: Readonly<Record<string, string>>,
  after: Readonly<Record<string, string>>,
): string[] {
  const settled = (path: string, text: string) =>
    path === "bg.json" ? text.replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"') : text;
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths.flatMap((path) => {
    const was = before[path];
    const now = after[path];
    if (was === undefined) {
      return [`${path} added`];
    }
    if (now === undefined) {
      return [`${path} removed`];
    }
    return settled(path, was) === settled(path, now) ? [] : [`${path} changed`];
  });
}

/** Every file of a project with its text, `node_modules` and `.git` left out. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })) {
    if (!/^(?:node_modules|\.git)\//.test(path)) {
      tree[path] = await Bun.file(join(root, path)).text();
    }
  }
  return tree;
}

/**
 * The argv of the one `bg add` golden runs: every module, then every item. One call, so a module
 * and the items that need it are planned together, and never `--force`: two installs that write
 * the same file have to fail here and not be settled by an overwrite. A name given twice, and an
 * empty side, fail, so a broken `bg list` is not a green run.
 */
export function addArguments(modules: readonly string[], items: readonly string[]): string[] {
  if (modules.length === 0) {
    throw new Error("no modules to add");
  }
  if (items.length === 0) {
    throw new Error("no items to add");
  }
  const names = [...modules, ...items];
  const twice = names.filter((name, index) => names.indexOf(name) !== index);
  if (twice.length > 0) {
    throw new Error(`named twice in one \`bg add\`: ${[...new Set(twice)].join(", ")}`);
  }
  return ["add", ...names, "--yes", "--no-install"];
}

/** How a command ended, for one that is expected to fail. */
export type Attempt = { code: number; stderr: string };

/**
 * An item that lands in `packages/ui` is refused until a `ui` module is named (030). Golden tries it
 * with the packed CLI in a project that has none, before installing anything: the refusal has to
 * carry the command that fixes it, as an agent running `bg add` reads it and nothing else.
 */
export function expectRefusal(attempt: Attempt, item: string, module: string): void {
  if (attempt.code === 0) {
    throw new Error(
      `\`bg add ${item}\` succeeded in a project with no ${module}: it must be refused`,
    );
  }
  const fix = `bg add ${module} ${item}`;
  if (!attempt.stderr.includes(fix)) {
    throw new Error(
      `\`bg add ${item}\` was refused without naming \`${fix}\`; it printed: ${attempt.stderr.trim() || "(nothing)"}`,
    );
  }
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

async function attempt(argv: string[], cwd: string): Promise<Attempt> {
  const proc = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "ignore", stderr: "pipe" });
  const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { code, stderr };
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
    // What `bunx create-bonne-garde` does first: the packed package has dependencies of its own,
    // and this copy sits in a temp directory with no node_modules to find them in.
    await run([BUN, "install"], cli);
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
    run(
      bg(
        "create",
        project,
        "--yes",
        "--no-git",
        "--no-install",
        "--scope",
        SCOPE,
        "--registry",
        registry,
      ),
      work,
    ),
  );
  await phase(timings, "refuse", async () => {
    if (!items.includes(REFUSED_ITEM) || !modules.includes(REFUSED_MODULE)) {
      throw new Error(
        `the refusal check needs ${REFUSED_ITEM} and ${REFUSED_MODULE} in the install`,
      );
    }
    const manifest = await Bun.file(join(project, "bg.json")).text();
    expectRefusal(
      await attempt(bg("add", REFUSED_ITEM, "--yes", "--no-install"), project),
      REFUSED_ITEM,
      REFUSED_MODULE,
    );
    if ((await Bun.file(join(project, "bg.json")).text()) !== manifest) {
      throw new Error(`the refused \`bg add ${REFUSED_ITEM}\` changed bg.json`);
    }
  });
  const added = await phase(timings, "add", async () => {
    const stdout = await capture(bg(...addArguments(modules, items)), project);
    process.stdout.write(stdout);
    const reported = readAddedModules(stdout, modules);
    expectPatches(reported, "applied", PATCHED);
    expectRegionsRecorded(JSON.parse(await Bun.file(join(project, "bg.json")).text()), reported);
    return reported;
  });
  // Before `bun install`, so that node_modules and the lockfile are not in the comparison.
  await phase(timings, "re-add", async () => {
    const before = await snapshot(project);
    const stdout = await capture(bg(...addArguments(modules, items)), project);
    expectPatches(readAddedModules(stdout, modules), "skipped", PATCHED);
    const changed = diffTrees(before, await snapshot(project));
    if (changed.length > 0) {
      throw new Error(`the same \`bg add\` again changed the project: ${changed.join(", ")}`);
    }
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
