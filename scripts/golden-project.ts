#!/usr/bin/env bun
/**
 * The golden project: what a consumer does, end to end, in a fresh directory, once per configuration.
 *
 *   bg create → bg add of a UI item, refused → bg add of the configuration's modules and every item in
 *   one call → the same bg add again, which must skip every patch and change nothing, and each module
 *   again on its own, which must too → bun install
 *   → typecheck → test → build → bg doctor --strict
 *   → for a configuration with a database: a table added to the schema barrel, `bun run db:generate`,
 *     the migration applied to a local D1 (`wrangler`, no network, no account), and what D1 holds read back
 *   → bun run check → the `checks` of every installed module
 *   → for the configuration that ships a Dockerfile, docker build, docker run, and the container's answers
 *
 * A configuration is a set of modules that fit in one project. `provider` admits one module and the
 * `api` module ships a variant per provider, so each provider is a configuration of its own: the
 * `cloudflare` one installs every item too, the `dockerfile` one only modules, and no SSR or static site.
 * Packing and the refusal run once.
 *
 * The image phases need a docker daemon. With no `docker` on PATH, or none that answers `docker info`,
 * golden says so, in the timing table too, and still exits 0: every other failure of them fails the run.
 * CI sets `GOLDEN_REQUIRE_DOCKER=1`, under which an unavailable docker fails the run instead.
 * What they create is named `bg-golden-<pid>` (image, container, volume) and removed by that name.
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

import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
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

/** One project golden builds: the modules `bg add` installs in one call, and whether every item comes with them. */
export type Configuration = {
  name: string;
  /** `<category>/<id>`, in the order they are given to `bg add`. */
  modules: readonly string[];
  /** Also install every item `bg list --items` shows. Items land in `packages/ui` and need the `ui` module. */
  items: boolean;
};

/**
 * The projects golden builds. A module that is in none of them, and not in `EXCLUDED_MODULES`, fails
 * the run, so a new module is a decision made here and not a silent gap. `provider` admits one module,
 * and a variant of `api` is selected on it, which is why each provider has a configuration.
 */
export const CONFIGURATIONS: readonly Configuration[] = [
  {
    name: "cloudflare",
    modules: [
      "provider/cloudflare",
      "tooling/vite-plus",
      "config/branding",
      "ui/shadcn",
      "api/elysia",
      "db/d1",
      "orm/drizzle",
      "web/spa",
      "web/ssr",
      "web/static",
    ],
    items: true,
  },
  {
    name: "dockerfile",
    modules: [
      "provider/dockerfile",
      "tooling/vite-plus",
      "config/branding",
      "ui/shadcn",
      "api/elysia",
      "web/spa",
    ],
    items: false,
  },
];

/** The module that ships the `Dockerfile` golden builds. */
const IMAGE_MODULE = "provider/dockerfile";

/** Whether the configuration ships a Dockerfile, so golden builds its image and asks the container. */
export function buildsImage(configuration: Configuration): boolean {
  return configuration.modules.includes(IMAGE_MODULE);
}

/** The module that turns a schema into migrations, so that there is a database to generate and migrate. */
const ORM_MODULE = "orm/drizzle";

/** Whether the configuration has an `orm`, so golden adds a table, generates its migration and applies it to a local D1. */
export function hasDatabase(configuration: Configuration): boolean {
  return configuration.modules.includes(ORM_MODULE);
}

/**
 * `orm/drizzle` ships an empty schema barrel: the tables are the modules' (`auth`, `storage`) and the
 * project's. Golden adds one the way the project does, a file of its own and a line in the barrel,
 * since `db:generate` has nothing to write for an empty schema.
 */
export const GOLDEN_TABLE = "golden_notes";
export const GOLDEN_SCHEMA_FILE = "packages/db/src/schema/golden-notes.ts";
export const GOLDEN_BARREL_FILE = "packages/db/src/schema/index.ts";
export const GOLDEN_BARREL_LINE = 'export { goldenNotes } from "./golden-notes";\n';
export const GOLDEN_SCHEMA = `import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const goldenNotes = sqliteTable("${GOLDEN_TABLE}", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
});
`;

/** The modules of every configuration, each once, in the order they first appear. */
export const MODULES: readonly string[] = [
  ...new Set(CONFIGURATIONS.flatMap((configuration) => configuration.modules)),
];

/** The item `refuse` tries with no ui module, and the module its refusal has to name. */
const REFUSED_ITEM = "button";
const REFUSED_MODULE = "ui/shadcn";

/**
 * Modules `bg list` shows that stay out of every configuration, each with its reason. An entry for
 * a module the registry no longer lists fails the run, as for `EXCLUDED`. Empty on purpose.
 */
export const EXCLUDED_MODULES: Readonly<Record<string, string>> = {};

/**
 * The module ids to `bg add`, read from the `module` lines of `bg list` output
 * (`<category>/<id><TAB>module<TAB>description`). `installed` is what golden installs, in that order,
 * over all configurations; every other listed module must be in `exclusions`.
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
 * The modules of each configuration whose variants declare a tier-2 patch, with the regions each
 * one's patches write there. Variants patch differently (`api/elysia` writes `dev` and `deploy` for
 * `wrangler` and only `dev` for the container), so this is per configuration. Golden checks that
 * `bg add` reports exactly these as `applied` and, run again, as `skipped`: a module that gains or
 * loses a patch is a decision made here, as a module that is not installed is.
 */
export const PATCHED: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> = {
  cloudflare: {
    "config/branding": ["scripts.gen:branding"],
    "api/elysia": ["scripts.deploy", "scripts.dev"],
    "db/d1": [
      "d1_databases",
      "env.production.d1_databases",
      "scripts.db:migrate:local",
      "scripts.db:migrate:remote",
    ],
    "orm/drizzle": [
      "dependencies.@app/db",
      "dependencies.drizzle-orm",
      "dependencies.elysia",
      "devDependencies.drizzle-kit",
      "elysia[app].use[dbModule]",
      'exports."."',
      'exports."./schema"',
      'exports."./testing"',
      "imports[@app/db]",
      "scripts.db:generate",
      "scripts.db:studio",
    ],
    "web/spa": ["scripts.deploy", "scripts.dev"],
    "web/ssr": ["scripts.deploy", "scripts.dev"],
    "web/static": ["scripts.deploy", "scripts.dev"],
  },
  dockerfile: {
    "config/branding": ["scripts.gen:branding"],
    "api/elysia": ["scripts.dev"],
    "web/spa": ["scripts.dev"],
  },
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
 * The argv of the one `bg add` golden runs per configuration: every module, then every item the
 * configuration has. One call, so a module and the items that need it are planned together, and never
 * `--force`: two installs that write the same file have to fail here and not be settled by an
 * overwrite. A name given twice, and no module, fail, so a broken `bg list` is not a green run (an
 * empty item list is `selectItems`'s to refuse: a configuration may have none).
 */
export function addArguments(modules: readonly string[], items: readonly string[]): string[] {
  if (modules.length === 0) {
    throw new Error("no modules to add");
  }
  const names = [...modules, ...items];
  const twice = names.filter((name, index) => names.indexOf(name) !== index);
  if (twice.length > 0) {
    throw new Error(`named twice in one \`bg add\`: ${[...new Set(twice)].join(", ")}`);
  }
  return ["add", ...names, "--yes", "--no-install"];
}

/**
 * What `bun run db:generate` left in `packages/db/migrations`: one migration, which creates `table`.
 * `files` is the directory listing, `sql` the text of the `.sql` file in it. Returns the file's name,
 * which is what D1 records as applied. An empty schema writes nothing, and a second migration would
 * mean a stale one is being taken for the new one.
 */
export function expectGenerated(files: readonly string[], sql: string, table: string): string {
  const migrations = files.filter((file) => file.endsWith(".sql")).sort();
  const [migration, ...others] = migrations;
  if (migration === undefined) {
    throw new Error(`db:generate wrote no migration (migrations/ holds: ${files.join(", ")})`);
  }
  if (others.length > 0) {
    throw new Error(`db:generate left ${migrations.join(", ")}: expected one migration`);
  }
  if (!sql.includes(`CREATE TABLE \`${table}\``)) {
    throw new Error(`${migration} does not create ${table}:\n${sql}`);
  }
  return migration;
}

/** The rows of the one statement `wrangler d1 execute --json` ran. */
export function d1Rows(stdout: string): Record<string, unknown>[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error(`wrangler d1 execute did not print JSON: ${stdout.trim() || "(nothing)"}`);
  }
  const [statement] = Array.isArray(parsed) ? parsed : [];
  if (!isRecord(statement)) {
    throw new Error("wrangler d1 execute printed no statement result");
  }
  if (statement.success !== true || !Array.isArray(statement.results)) {
    throw new Error(`wrangler d1 execute reported no success: ${JSON.stringify(statement)}`);
  }
  return statement.results.filter(isRecord);
}

/** What D1 holds after `db:migrate:local`: its tables, and the migrations it recorded as applied. */
export type MigratedDatabase = { tables: readonly string[]; applied: readonly string[] };

/** The table exists and D1 recorded the generated migration: a table made another way proves nothing. */
export function expectMigrated(database: MigratedDatabase, table: string, migration: string): void {
  if (!database.applied.includes(migration)) {
    throw new Error(
      `d1_migrations holds [${database.applied.join(", ")}], not ${migration}: the migration was not applied`,
    );
  }
  if (!database.tables.includes(table)) {
    throw new Error(`${migration} was recorded as applied, but D1 has no table ${table}`);
  }
}

/** A second `db:migrate:local` finds nothing to do: what is applied is not applied again. */
export function expectNothingToApply(stdout: string): void {
  if (!stdout.includes("No migrations to apply")) {
    throw new Error(
      `the second run of db:migrate:local did not say there was nothing to apply:\n${stdout}`,
    );
  }
}

/**
 * How many tests each workspace ran, read from the prefixed output of the root `test` script: the
 * `Ran N tests` line of `bun test` (which prints it on stderr) and the `Tests  N passed` line of Vitest.
 */
export function testCounts(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of output.split("\n")) {
    const [, workspace, ran] =
      /^(\S+):test\s*\|\s*(?:Ran |Tests\s+)(\d+) (?:tests? |passed)/.exec(line) ?? [];
    if (workspace !== undefined && ran !== undefined) {
      counts[workspace] = Number(ran);
    }
  }
  return counts;
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

/** The port the image listens on: the Dockerfile's `PORT`. */
const CONTAINER_PORT = 5172;

/**
 * Why the image phases cannot run, or null when they can. `probe` is how `docker info` ended, or
 * null when `docker` is not on PATH. Only the absence of a daemon skips: a build or a container that
 * fails with one running is a failed run.
 */
export function dockerSkipReason(probe: Attempt | null): string | null {
  if (probe === null) {
    return "docker unavailable: not on PATH";
  }
  return probe.code === 0 ? null : `docker unavailable: \`docker info\` exited with ${probe.code}`;
}

/** The environment variable that turns a skipped image phase into a failed run: CI sets it. */
export const DOCKER_REQUIRED = "GOLDEN_REQUIRE_DOCKER";

/**
 * Whether the variable asks for docker: unset, empty, `0` and `false` do not, anything else does, so
 * a spelling nobody planned (`yes`) fails safe, as a run that requires docker, and not as one that skips.
 */
export function requiresDocker(value: string | undefined): boolean {
  return value !== undefined && value !== "" && value !== "0" && value !== "false";
}

/**
 * What to do about the image phases: null to run them, the reason to skip them, and a throw when
 * `required` and docker is unavailable, so that CI cannot go green without having built the image.
 */
export function dockerDecision(probe: Attempt | null, required: boolean): string | null {
  const reason = dockerSkipReason(probe);
  if (reason !== null && required) {
    throw new Error(`${reason}, and ${DOCKER_REQUIRED} is set`);
  }
  return reason;
}

/** The name of the image, the container and the volume of one run: unique to this process. */
export function dockerName(pid: number): string {
  return `bg-golden-${pid}`;
}

/** The host port of the binding `docker port <name> <port>/tcp` prints, the first one when there are several. */
export function publishedPort(output: string): number {
  const port = /:(\d+)\s*$/m.exec(output)?.[1];
  if (port === undefined) {
    throw new Error(`docker port printed no port: ${output.trim() || "(nothing)"}`);
  }
  return Number(port);
}

/** What golden reads of a response. */
export type Served = { status: number; contentType: string | null };

/** The response has to carry `status` and the media type `type`, whatever parameters follow it (`; charset=utf-8`). */
export function expectServed(what: string, served: Served, status: number, type: string): void {
  const media = served.contentType?.split(";")[0]?.trim().toLowerCase() ?? "no content type";
  if (served.status !== status || media !== type) {
    throw new Error(`${what}: expected ${status} ${type}, got ${served.status} ${media}`);
  }
}

/** The first script of /assets that the built index.html loads: a hashed file, so its name is read, not written. */
export function assetPath(html: string): string {
  const path = /(?:src|href)="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  if (path === undefined) {
    throw new Error("the index.html served loads no script from /assets");
  }
  return path;
}

/**
 * Asks `check` until it passes or `timeoutMs` has gone by, `intervalMs` apart. A check that throws is
 * not ready yet (a connection refused while the server starts). Each ask has to bound itself: this
 * does not interrupt one.
 */
export async function until(
  check: () => Promise<boolean>,
  { timeoutMs, intervalMs }: { timeoutMs: number; intervalMs: number },
): Promise<boolean> {
  const deadline = performance.now() + timeoutMs;
  while (true) {
    try {
      if (await check()) {
        return true;
      }
    } catch {
      // not ready yet
    }
    if (performance.now() >= deadline) {
      return false;
    }
    await Bun.sleep(intervalMs);
  }
}

/** One row of the timing table. A `note` stands where the seconds do, for a phase that did not run. */
type Timing = { phase: string; ms: number; note?: string };

function seconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** The environment of a command that runs `wrangler` against local state: no metrics, so nothing leaves the machine. */
const OFFLINE = { WRANGLER_SEND_METRICS: "false" };

async function run(argv: string[], cwd: string, env?: Record<string, string>): Promise<void> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  const code = await proc.exited;
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
}

async function capture(argv: string[], cwd: string, env?: Record<string, string>): Promise<string> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "inherit",
    ...(env === undefined ? {} : { env: { ...process.env, ...env } }),
  });
  const [code, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()]);
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
  return stdout;
}

/** Both streams of a command that has to succeed: `bun test` prints its report on stderr. */
async function captureBoth(
  argv: string[],
  cwd: string,
): Promise<{ stdout: string; stderr: string }> {
  const proc = Bun.spawn(argv, { cwd, stdin: "ignore", stdout: "pipe", stderr: "pipe" });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  process.stderr.write(stderr);
  process.stdout.write(stdout);
  if (code !== 0) {
    throw new Error(`\`${argv.join(" ")}\` exited with ${code}`);
  }
  return { stdout, stderr };
}

async function attempt(argv: string[], cwd: string, timeoutMs?: number): Promise<Attempt> {
  const proc = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "ignore",
    stderr: "pipe",
    ...(timeoutMs === undefined ? {} : { timeout: timeoutMs }),
  });
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

  await phase(timings, "pack", async () => {
    await run([BUN, "run", "pack:cli"], ROOT);
    await cp(PACKED_CLI, cli, { recursive: true });
    // What `bunx create-bonne-garde` does first: the packed package has dependencies of its own,
    // and this copy sits in a temp directory with no node_modules to find them in.
    await run([BUN, "install"], cli);
  });

  const { items, excluded } = await phase(timings, "list", async () => {
    const fromItems = selectItems(
      await capture(bg("list", "--items", "--source", registry), work),
      EXCLUDED,
    );
    const fromModules = selectModules(
      await capture(bg("list", "--source", registry), work),
      MODULES,
      EXCLUDED_MODULES,
    );
    return { items: fromItems.items, excluded: [...fromItems.excluded, ...fromModules.excluded] };
  });
  for (const { name, reason } of excluded) {
    console.log(`golden: leaving out ${name}: ${reason}`);
  }

  for (const [index, configuration] of CONFIGURATIONS.entries()) {
    await configured(work, timings, { bg, registry, items, configuration, first: index === 0 });
  }
}

/** One configuration, from `bg create` to the modules' `checks`. */
async function configured(
  work: string,
  timings: Timing[],
  options: {
    bg: (...args: string[]) => string[];
    registry: string;
    items: readonly string[];
    configuration: Configuration;
    first: boolean;
  },
): Promise<void> {
  const { bg, registry, configuration, first } = options;
  const { name, modules } = configuration;
  const installed = configuration.items ? options.items : [];
  const patched = PATCHED[name] ?? {};
  const project = join(work, `golden-${name}`);
  const step = <T>(label: string, body: () => Promise<T>) =>
    phase(timings, `${name}: ${label}`, body);

  console.log(`\ngolden: configuration ${name}: ${modules.join(" ")}`);
  await step("create", () =>
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
  // The refusal does not depend on the provider: once is enough.
  if (first) {
    await step("refuse", async () => {
      if (!options.items.includes(REFUSED_ITEM) || !modules.includes(REFUSED_MODULE)) {
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
  }
  const added = await step("add", async () => {
    const stdout = await capture(bg(...addArguments(modules, installed)), project);
    process.stdout.write(stdout);
    const reported = readAddedModules(stdout, modules);
    expectPatches(reported, "applied", patched);
    expectRegionsRecorded(JSON.parse(await Bun.file(join(project, "bg.json")).text()), reported);
    return reported;
  });
  // Before `bun install`, so that node_modules and the lockfile are not in the comparison.
  await step("re-add", async () => {
    const before = await snapshot(project);
    const stdout = await capture(bg(...addArguments(modules, installed)), project);
    expectPatches(readAddedModules(stdout, modules), "skipped", patched);
    const changed = diffTrees(before, await snapshot(project));
    if (changed.length > 0) {
      throw new Error(`the same \`bg add\` again changed the project: ${changed.join(", ")}`);
    }
  });
  // Each module on its own, after the whole set was installed in one call: a file one module vendors
  // and another patched (db/d1's package.json, api/elysia's app.ts) is the project's by then, and the
  // owner asked for alone has to keep it, skip its patches and change nothing.
  await step("re-add alone", async () => {
    for (const module of modules) {
      const before = await snapshot(project);
      const stdout = await capture(bg(...addArguments([module], [])), project);
      const expected = Object.fromEntries(
        Object.entries(patched).filter(([name]) => name === module),
      );
      expectPatches(readAddedModules(stdout, [module]), "skipped", expected);
      const changed = diffTrees(before, await snapshot(project));
      if (changed.length > 0) {
        throw new Error(`\`bg add ${module}\` alone changed the project: ${changed.join(", ")}`);
      }
    }
  });
  await step("install", () => run([BUN, "install"], project));
  await step("typecheck", () => run([BUN, "run", "typecheck"], project));
  await step("test", async () => {
    const { stdout, stderr } = await captureBoth([BUN, "run", "test"], project);
    const counts = Object.entries(testCounts(`${stdout}\n${stderr}`));
    console.log(
      `golden: tests run: ${counts.map(([workspace, ran]) => `${workspace} ${ran}`).join(", ")}`,
    );
  });
  await step("build", () => run([BUN, "run", "build"], project));
  await step("doctor", () => run(bg("doctor", "--strict"), project));
  if (hasDatabase(configuration)) {
    await migrated(project, timings, name);
  }
  await step("check", () => run([BUN, "run", "check"], project));
  for (const { module, checks } of added.filter(({ checks }) => checks.length > 0)) {
    await step(`checks:${module}`, async () => {
      for (const command of checks) {
        await run(["sh", "-c", command], project);
      }
    });
  }
  if (buildsImage(configuration)) {
    await imaged(project, timings, name);
  }
}

/**
 * The database of a project with an `orm`: a table added to the schema barrel, `bun run db:generate`
 * writing its migration, `bun run db:migrate:local` applying it to the local D1 `wrangler` keeps under
 * `apps/api/.wrangler` (no network, no Cloudflare account, the placeholder `database_id` of the
 * module), and the database read back: the table is there and the migration is the one D1 recorded.
 * It runs after `doctor`, which would report the barrel as edited, and before `check`, which has to
 * pass over what `db:generate` wrote.
 */
async function migrated(project: string, timings: Timing[], name: string): Promise<void> {
  const db = join(project, "packages/db");
  const api = join(project, "apps/api");
  let migration = "";

  await phase(timings, `${name}: db generate`, async () => {
    await Bun.write(join(project, GOLDEN_SCHEMA_FILE), GOLDEN_SCHEMA);
    const barrel = join(project, GOLDEN_BARREL_FILE);
    await Bun.write(barrel, `${await Bun.file(barrel).text()}${GOLDEN_BARREL_LINE}`);
    await run([BUN, "run", "db:generate"], db);
    const directory = join(db, "migrations");
    const files = await readdir(directory);
    const [first] = files.filter((file) => file.endsWith(".sql"));
    const sql = first === undefined ? "" : await Bun.file(join(directory, first)).text();
    migration = expectGenerated(files, sql, GOLDEN_TABLE);
  });

  await phase(timings, `${name}: db migrate`, async () => {
    await run([BUN, "run", "db:migrate:local"], api, OFFLINE);
    const rows = async (statement: string, column: string): Promise<string[]> =>
      d1Rows(
        await capture(
          ["bunx", "wrangler", "d1", "execute", "DB", "--local", "--json", "--command", statement],
          api,
          OFFLINE,
        ),
      ).flatMap((row) => (typeof row[column] === "string" ? [row[column]] : []));
    expectMigrated(
      {
        tables: await rows("SELECT name FROM sqlite_master WHERE type = 'table'", "name"),
        applied: await rows("SELECT name FROM d1_migrations ORDER BY id", "name"),
      },
      GOLDEN_TABLE,
      migration,
    );
    expectNothingToApply(await capture([BUN, "run", "db:migrate:local"], api, OFFLINE));
  });
}

/**
 * The image of a project that ships a Dockerfile: built, run on a host port docker picks, asked for
 * what a deployed container answers, then removed. Everything it creates is named `bg-golden-<pid>`
 * and removed by that name, the container first since it holds the image and the volume. Nothing
 * else on the machine is touched: no prune, no cache clear.
 */
async function imaged(project: string, timings: Timing[], name: string): Promise<void> {
  const label = `${name}: docker`;
  const probe =
    Bun.which("docker") === null ? null : await attempt(["docker", "info"], project, 20_000);
  let skipped: string | null;
  try {
    skipped = dockerDecision(probe, requiresDocker(process.env[DOCKER_REQUIRED]));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`phase "${label}" failed: ${reason}`);
  }
  if (skipped !== null) {
    console.log(`\n${label}  skipped (${skipped})`);
    timings.push({ phase: label, ms: 0, note: `skipped (${skipped})` });
    return;
  }

  const docker = dockerName(process.pid);
  try {
    await phase(timings, `${label} build`, () =>
      run(["docker", "build", "-t", docker, "."], project),
    );
    await phase(timings, `${label} run`, async () => {
      try {
        await answers(project, docker);
      } catch (error) {
        console.log(`\ngolden: last lines of the container ${docker}`);
        await run(["docker", "logs", "--tail", "40", docker], project).catch(() => undefined);
        throw error;
      }
    });
  } finally {
    for (const [kind, argv] of [
      ["container", ["docker", "rm", "-f", docker]],
      ["volume", ["docker", "volume", "rm", docker]],
      ["image", ["docker", "image", "rm", docker]],
    ] as const) {
      const { code, stderr } = await attempt([...argv], project);
      // Nothing to remove when the build or the run failed before it existed.
      if (code !== 0 && !/no such/i.test(stderr)) {
        console.warn(`golden: could not remove the ${kind} ${docker}: ${stderr.trim()}`);
      }
    }
  }
}

/** Starts the container, waits for `/health`, and checks what it serves: the API, the SPA, a hashed asset, a client route. */
async function answers(project: string, docker: string): Promise<void> {
  await run(
    [
      "docker",
      "run",
      "-d",
      "--name",
      docker,
      "-v",
      `${docker}:/data`,
      "-p",
      `127.0.0.1::${CONTAINER_PORT}`,
      docker,
    ],
    project,
  );
  const port = publishedPort(
    await capture(["docker", "port", docker, `${CONTAINER_PORT}/tcp`], project),
  );
  const get = async (path: string, accept?: string): Promise<Served & { body: string }> => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, {
      headers: accept === undefined ? {} : { accept },
      signal: AbortSignal.timeout(2000),
    });
    return {
      status: response.status,
      contentType: response.headers.get("content-type"),
      body: await response.text(),
    };
  };

  const ready = await until(async () => (await get("/health")).status === 200, {
    timeoutMs: 60_000,
    intervalMs: 500,
  });
  if (!ready) {
    throw new Error("the container did not answer GET /health with 200 within 60 s");
  }
  expectServed("GET /health", await get("/health"), 200, "application/json");
  const home = await get("/");
  expectServed("GET /", home, 200, "text/html");
  const asset = assetPath(home.body);
  expectServed(`GET ${asset}`, await get(asset), 200, "text/javascript");
  // A client route has no file: the runtime answers a navigation with the SPA's index.html.
  const route = "/golden/unknown-client-route";
  const client = await get(route, "text/html");
  expectServed(`GET ${route} (Accept: text/html)`, client, 200, "text/html");
  if (client.body !== home.body) {
    throw new Error(`GET ${route} (Accept: text/html) answered something other than GET /`);
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
  for (const { phase: name, ms, note } of timings) {
    console.log(`  ${name.padEnd(width)} ${note ?? seconds(ms)}`);
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
