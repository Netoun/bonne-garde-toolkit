#!/usr/bin/env bun
/**
 * The golden project: what a consumer does, end to end, in a fresh directory.
 *
 *   bg create → bg add → bun install → typecheck → test → bg doctor --strict
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
 * item the registry no longer lists fails the run, so this list cannot go stale.
 */
const EXCLUDED: Readonly<Record<string, string>> = {
  "spa-react-router":
    "registry/apps/registry.json vendors 3 of the 8 files in the item directory (no src/root.tsx, react-router.config.ts, vite.config.ts), so `react-router typegen` finds no app/root.tsx",
};

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

  const { items, excluded } = await phase(timings, "list", async () =>
    selectItems(await capture(bg("list", "--source", registry), work), EXCLUDED),
  );
  for (const { name, reason } of excluded) {
    console.log(`golden: leaving out ${name}: ${reason}`);
  }

  await phase(timings, "create", () =>
    run(bg("create", project, "--yes", "--no-git", "--no-install", "--registry", registry), work),
  );
  await phase(timings, "add", () => run(bg("add", ...items, "--yes", "--no-install"), project));
  await phase(timings, "install", () => run([BUN, "install"], project));
  await phase(timings, "typecheck", () => run([BUN, "run", "typecheck"], project));
  await phase(timings, "test", () => run([BUN, "run", "test"], project));
  await phase(timings, "doctor", () => run(bg("doctor", "--strict"), project));
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
  for (const { phase: name, ms } of timings) {
    console.log(`  ${name.padEnd(10)} ${seconds(ms)}`);
  }
  console.log(`  ${"total".padEnd(10)} ${seconds(performance.now() - start)}`);

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
