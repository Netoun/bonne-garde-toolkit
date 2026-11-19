#!/usr/bin/env bun
/**
 * The golden project: what a consumer does, end to end, in a fresh directory, once per configuration.
 *
 *   bonne-garde create → bonne-garde add of a UI item, refused → bonne-garde add of a feature item, refused in a bare project and in
 *   a project that lacks only auth, or only storage → bonne-garde add of the configuration's modules and every
 *   item in one call (the feature items' dependencies written into apps/spa/package.json) → the same
 *   bonne-garde add again, which must skip every patch and change nothing, and each module and each feature
 *   item again on its own, which must too → bun install
 *   → typecheck → test → build → bonne-garde doctor --strict
 *   → for a configuration with a database: a table added to the schema barrel, `bun run db:generate`,
 *     the migration applied to a local D1 (`wrangler`, no network, no account), and what D1 holds read back,
 *     the tables of its modules (`medias`, storage's) in the migration and in D1 as well
 *   → for a configuration with the feature items: the spa's tests counted, which are the shell's and theirs
 *   → for a configuration with storage: the tests of `@scope/storage` counted, since the media routes
 *     run only in the project (they import packages a project installs)
 *   → for a configuration with auth: `bun run auth:generate` again, which has to write the schema the
 *     module ships byte for byte (it is generator output, not a hand-edited file); `db:seed`, then a row
 *     in every other table (a media with an author and no organization among them), `db:reset`, which has
 *     to empty every table of the barrel, `db:seed` again, and once more on the seeded database, which has
 *     to say so, exit 0 and change no row
 *   → for a configuration with the deploy module: the workflow parsed, the plan of its dry run, and the
 *     module refused, naming the provider, in the configuration on the other one
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
 * The CLI under test is the packed one (`bun run pack:cli`), driven by node as a subprocess so argv
 * parsing is exercised and so the path a user of npm, pnpm or yarn takes is the one proven (it needs
 * Node 22.12 or later on PATH). It runs from a copy outside the repo: the packed `paths.ts` still
 * walks up to find the repo root, and `templateBaseDir()` falls back to the repo's `templates/base`,
 * so in place under `dist/` a pack that dropped its `templates/` would still pass. From a copy under
 * the temp directory, `bonne-garde create` can only use what the pack carries.
 *
 * Usage:
 *   bun run golden
 *   bun scripts/golden-project.ts
 */

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { cp, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, delimiter, join, relative, resolve } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { type Choices, namesFor } from "../packages/cli/src/choices";
import { cliRunner } from "../packages/schema/src/cli-runner";

const ROOT = resolve(import.meta.dir, "..");
const PACKED_CLI = join(ROOT, "dist/npm/bonne-garde");
const BUN = "bun";
/** The packed CLI is run by node, as `npx`, `pnpm dlx` and `yarn dlx` run it: golden proves that path. */
const NODE = "node";

/**
 * The project's npm scope. Registry files are authored for `@acme` and `add` rewrites the scope at
 * copy time, which moves line lengths and so where the formatter wraps. A scope of `@acme`'s length
 * could not show it, and the one `create` derives from the directory name (`@golden-app`) happened
 * to wrap like it. `@app` is shorter: it un-wraps what `@acme` had to wrap.
 */
export const SCOPE = "@app";

/**
 * Items `bonne-garde list` shows that stay out of the golden project, each with its reason. An entry for an
 * item the registry no longer lists fails the run, so this list cannot go stale. Empty on purpose:
 * every item the registry ships is installed, and a new one is a decision made here.
 */
export const EXCLUDED: Readonly<Record<string, string>> = {};

export type Excluded = { name: string; reason: string };

/** The item names to `bonne-garde add`, read from `bonne-garde list` output (`name<TAB>type<TAB>description`). */
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
    throw new Error("bonne-garde list left no items to install");
  }

  return {
    items,
    excluded: listed
      .filter((name) => Object.hasOwn(exclusions, name))
      .map((name) => ({ name, reason: exclusions[name] ?? "" })),
  };
}

/** One project golden builds: the modules `bonne-garde add` installs in one call, and whether every item comes with them. */
export type Configuration = {
  name: string;
  /** `<category>/<id>`, in the order they are given to `bonne-garde add`. */
  modules: readonly string[];
  /** Also install every item `bonne-garde list --items` shows. Items land in `packages/ui` and need the `ui` module. */
  items: boolean;
};

/**
 * The answer sets golden builds, each as `bonne-garde create` maps it, so a set golden proves is one
 * `create` produces. A module that is in none of them, and not in `EXCLUDED_MODULES`, fails the run,
 * so a new module is a decision made here and not a silent gap. `provider` admits one module, and a
 * variant of `api` is selected on it, which is why each provider has a set.
 */
export const ANSWER_SETS: Readonly<Record<string, Choices>> = {
  cloudflare: {
    apps: ["api", "spa", "ssr", "static"],
    provider: "cloudflare",
    features: ["db", "auth", "storage", "email", "deploy", "backoffice", "portless"],
    // The most modules, under the stricter install: pnpm links only what a package.json declares.
    pm: "pnpm",
  },
  dockerfile: {
    apps: ["api", "spa"],
    provider: "dockerfile",
    features: ["db", "email", "portless"],
    pm: "bun",
  },
  // The fronts alone: no api, so no Eden client and no API variable, deployed.
  fronts: {
    apps: ["spa", "ssr", "static"],
    provider: "cloudflare",
    features: ["deploy"],
    pm: "bun",
  },
};

/**
 * A set with items installs every item here, not only its own: that its own build alone is
 * `feature-contract.test.ts`'s, where an item declares every item it imports.
 */
export const CONFIGURATIONS: readonly Configuration[] = Object.entries(ANSWER_SETS).map(
  ([name, choices]) => {
    const { modules, items } = namesFor(choices);
    return { name, modules, items: items.length > 0 };
  },
);

/**
 * The package manager of a configuration, its `pm` module's id: `create --pm` adds that module, and
 * golden's `bonne-garde add` adds the rest.
 */
export function packageManagerOf(configuration: Configuration): string {
  const [pm, ...more] = configuration.modules.filter((module) => module.startsWith("pm/"));
  if (pm === undefined || more.length > 0) {
    throw new Error(`the ${configuration.name} configuration has to name one pm module`);
  }
  return pm.slice("pm/".length);
}

/** The modules golden's `bonne-garde add` installs: all but the package manager's, which `create` added. */
export function addedModules(configuration: Configuration): string[] {
  return configuration.modules.filter((module) => !module.startsWith("pm/"));
}

/** How golden drives a project with its package manager: the install, a script, a bin the project has. */
export type Runner = {
  install: string[];
  run: (script: string, ...args: string[]) => string[];
  exec: (bin: string, ...args: string[]) => string[];
};

export function runnerOf(pm: string): Runner {
  if (pm === "bun") {
    return {
      install: [BUN, "install"],
      run: (script, ...args) => [BUN, "run", script, ...args],
      exec: (bin, ...args) => [BUN, "x", bin, ...args],
    };
  }
  if (pm === "pnpm") {
    return {
      install: ["pnpm", "install"],
      run: (script, ...args) => ["pnpm", "run", script, ...args],
      exec: (bin, ...args) => ["pnpm", "exec", bin, ...args],
    };
  }
  throw new Error(`golden does not drive ${pm}`);
}

/** The module that ships the `Dockerfile` golden builds. */
const IMAGE_MODULE = "provider/dockerfile";

/** Whether the configuration ships a Dockerfile, so golden builds its image and asks the container. */
export function buildsImage(configuration: Configuration): boolean {
  return configuration.modules.includes(IMAGE_MODULE);
}

/** The module that turns a schema into migrations, so that there is a database to generate and migrate. */
const ORM_MODULE = "orm/drizzle";

/** The database of the cloudflare provider, the one `wrangler` keeps locally. */
const D1_MODULE = "db/d1";

/** The database of the dockerfile provider: an SQLite file under the container's `DATA_DIR`. */
const LIBSQL_MODULE = "db/libsql";

/** Where the container's volume holds the database, once the API has opened it. */
export const SQLITE_FILE = "/data/db.sqlite";

/** Whether the configuration has an `orm` over D1, so golden adds a table, generates its migration and applies it to a local D1. */
export function hasDatabase(configuration: Configuration): boolean {
  return configuration.modules.includes(ORM_MODULE) && configuration.modules.includes(D1_MODULE);
}

/** Whether the image opens an SQLite file, which golden looks for in the container's volume. */
export function hasSqliteFile(configuration: Configuration): boolean {
  return buildsImage(configuration) && configuration.modules.includes(LIBSQL_MODULE);
}

/** The module whose schema is what `auth:generate` writes, and the file that holds it. */
const AUTH_MODULE = "auth/better-auth";
export const AUTH_SCHEMA_FILE = "packages/auth/src/schema.ts";

/** Whether the configuration has auth, so golden generates its schema again and compares. */
export function hasAuth(configuration: Configuration): boolean {
  return configuration.modules.includes(AUTH_MODULE);
}

/** The module whose tests golden has to see run, and whose table has to be in the migration. */
const STORAGE_MODULE = "storage/r2";

/** Whether the configuration has storage, so golden counts its tests and expects its table in the migration. */
export function hasStorage(configuration: Configuration): boolean {
  return configuration.modules.includes(STORAGE_MODULE);
}

/**
 * The schema `auth:generate` writes has to be the one the module ships. The legacy file kept a hand
 * edit the generator would drop on its next run, so this is what says the module has none.
 */
export function expectRegenerated(shipped: string, regenerated: string): void {
  if (regenerated === shipped) {
    return;
  }
  const was = shipped.split("\n");
  const now = regenerated.split("\n");
  const line = was.findIndex((text, index) => text !== now[index]);
  const at = line === -1 ? Math.min(was.length, now.length) : line;
  throw new Error(
    `\`bun run auth:generate\` wrote a ${AUTH_SCHEMA_FILE} that differs from the shipped one, from line ${at + 1}: ` +
      `shipped \`${was[at] ?? "(end of file)"}\`, generated \`${now[at] ?? "(end of file)"}\``,
  );
}

/** The admin `db:seed` creates (`packages/auth/src/seed.ts`), which golden reads back from D1. */
export const SEEDED_ADMIN = "admin@example.local";

/**
 * What `db:seed` left in D1: one user, the admin, verified, who owns one organization. It deletes
 * nothing and leaves a database that has the admin as it is, so after `db:reset` or a second run it is
 * the same rows, not two admins.
 */
export function expectSeeded(
  users: readonly Record<string, unknown>[],
  members: readonly Record<string, unknown>[],
): void {
  const [admin, ...others] = users;
  if (admin === undefined || others.length > 0 || admin.email !== SEEDED_ADMIN) {
    throw new Error(`D1 holds users ${JSON.stringify(users)}, expected only ${SEEDED_ADMIN}`);
  }
  if (admin.email_verified !== 1) {
    throw new Error(`the seeded admin is not verified: ${JSON.stringify(admin)}`);
  }
  const [owner, ...rest] = members;
  if (owner === undefined || rest.length > 0 || owner.role !== "owner") {
    throw new Error(
      `D1 holds members ${JSON.stringify(members)}, expected the admin as the one owner`,
    );
  }
}

/**
 * What a project needs for `auth/better-auth` but its ORM. Adding auth to it is refused, and the
 * message names the missing peer's category, before anything is written.
 */
export const WITHOUT_ORM: readonly string[] = [
  "provider/cloudflare",
  "config/branding",
  "api/elysia",
  "db/d1",
];

/** `bonne-garde add <name>` failed and named `category` as the peer it needs: what an agent reads to fix it. */
export function expectPeerRefusal(attempt: Attempt, name: string, category: string): void {
  if (attempt.code === 0) {
    throw new Error(
      `\`bonne-garde add ${name}\` succeeded in a project with no ${category} module: it must be refused`,
    );
  }
  if (!attempt.stderr.includes(`category ${category}`)) {
    throw new Error(
      `\`bonne-garde add ${name}\` was refused without naming the missing peer category ${category}; it printed: ${attempt.stderr.trim() || "(nothing)"}`,
    );
  }
}

/** The module that ships the deploy workflow, the provider it accepts, and the root script its workflow calls. */
export const DEPLOY_MODULE = "deploy/cloudflare-actions";
const DEPLOY_PROVIDER = "provider/cloudflare";
const DEPLOY_WORKFLOW = ".github/workflows/deploy.yml";
const DEPLOY_SCRIPT = "deploy:cloudflare";

/** Whether the configuration installs the deploy module, so golden checks the plan its script prints. */
export function hasDeploy(configuration: Configuration): boolean {
  return configuration.modules.includes(DEPLOY_MODULE);
}

/** Whether the configuration is on a provider the deploy module does not accept, so golden has to see it refused. */
export function refusesDeploy(configuration: Configuration): boolean {
  return !configuration.modules.includes(DEPLOY_PROVIDER);
}

/**
 * What `bun run deploy:cloudflare --dry-run` has to plan in each configuration that installs the
 * module, one `<phase> <cwd>: <command>` per step. The order is the contract: every build before the
 * first deploy, the database's app first with its migration right before it, the others by directory.
 * `my-app-*` are the Pages project names the web modules' wrangler configs carry.
 */
export const DEPLOY_PLAN: Readonly<Record<string, readonly string[]>> = {
  cloudflare: [
    "build apps/api: vp run build",
    "build apps/spa: vp run build",
    "build apps/ssr: vp run build",
    "build apps/static: vp run build",
    "migrate apps/api: vp run db:migrate:remote --env production",
    "deploy apps/api: vp run deploy --env production",
    "deploy apps/spa: vp run deploy --project-name my-app-spa --branch main",
    "deploy apps/ssr: vp run deploy --env production",
    "deploy apps/static: vp run deploy --project-name my-app-static --branch main",
  ],
  // No API: nothing to migrate, and each front deploys on its own.
  fronts: [
    "build apps/spa: vp run build",
    "build apps/ssr: vp run build",
    "build apps/static: vp run build",
    "deploy apps/spa: vp run deploy --project-name my-app-spa --branch main",
    "deploy apps/ssr: vp run deploy --env production",
    "deploy apps/static: vp run deploy --project-name my-app-static --branch main",
  ],
};

/**
 * What each app the plan builds needs of the workflow's variables, in each configuration that installs the
 * deploy module, by the directory it is built in. Written out by hand, not read from the files the script
 * reads: the SPA and the static site read `VITE_API_URL` when they build and throw at load without it; and
 * the Worker `ssr` reads `API_URL` from its wrangler config at run time and needs no build variable. Fronts
 * installed without the API have no API URL to read, so they need none.
 */
export const DEPLOY_BUILD_NEEDS: Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
> = {
  cloudflare: { "apps/spa": ["VITE_API_URL"], "apps/static": ["VITE_API_URL"] },
  fronts: {},
};

/** The plan the dry run printed: each step as `<phase> <cwd>: <command>`, the apps once each in order, the build variables it names. */
export type DeployPlan = { steps: string[]; apps: string[]; buildVars: string[] };

export function readDeployPlan(stdout: string): DeployPlan {
  let printed: unknown;
  try {
    printed = JSON.parse(stdout);
  } catch {
    throw new Error(`the dry run printed output that is not JSON: ${stdout.trim() || "(nothing)"}`);
  }
  if (!isRecord(printed) || !Array.isArray(printed.steps) || !isStringArray(printed.buildVars)) {
    throw new Error("the dry run printed no `steps` and `buildVars`");
  }
  const steps: string[] = [];
  const apps: string[] = [];
  for (const step of printed.steps) {
    if (
      !isRecord(step) ||
      typeof step.phase !== "string" ||
      typeof step.cwd !== "string" ||
      !isStringArray(step.argv)
    ) {
      throw new Error(
        `the dry run printed a step with no phase, cwd and argv: ${JSON.stringify(step)}`,
      );
    }
    steps.push(`${step.phase} ${step.cwd}: ${step.argv.join(" ")}`);
    if (!apps.includes(step.cwd)) {
      apps.push(step.cwd);
    }
  }
  return { steps, apps, buildVars: printed.buildVars };
}

/** The variables each build needs, as the dry run prints them (`requiredBuildVars`: names, by app directory). */
export function readDeployNeeds(stdout: string): Record<string, string[]> {
  let printed: unknown;
  try {
    printed = JSON.parse(stdout);
  } catch {
    throw new Error(`the dry run printed output that is not JSON: ${stdout.trim() || "(nothing)"}`);
  }
  const needs = isRecord(printed) ? printed.requiredBuildVars : undefined;
  if (!isRecord(needs) || !Object.values(needs).every(isStringArray)) {
    throw new Error(
      "the dry run printed no `requiredBuildVars`, an object of variable names by app",
    );
  }
  return Object.fromEntries(
    Object.entries(needs).flatMap(([app, names]) => (isStringArray(names) ? [[app, names]] : [])),
  );
}

/** What the script derives from the installed apps is what golden expects each build to need: names the first app that differs. */
export function expectBuildNeeds(
  planned: Readonly<Record<string, readonly string[]>>,
  expected: Readonly<Record<string, readonly string[]>>,
): void {
  for (const app of [...new Set([...Object.keys(planned), ...Object.keys(expected)])].sort()) {
    const got = (planned[app] ?? []).join(", ") || "(nothing)";
    const want = (expected[app] ?? []).join(", ") || "(nothing)";
    if (got !== want) {
      throw new Error(`${app} needs ${got} to build, golden expects ${want}`);
    }
  }
}

/**
 * A dry run handed variables that lack what a build needs is refused: it exits non-zero, names each app
 * and each variable it lacks, and prints none of the values it was handed (`secrets`).
 */
export function expectBuildVarsRefusal(
  result: { code: number; output: string },
  expected: Readonly<Record<string, readonly string[]>>,
  secrets: readonly string[],
): void {
  if (result.code === 0) {
    throw new Error(
      "the dry run passed variables that lack what a build needs: it must be refused",
    );
  }
  for (const [app, names] of Object.entries(expected)) {
    for (const name of [app, ...names]) {
      if (!result.output.includes(name)) {
        throw new Error(
          `the refusal does not name ${name}; it printed: ${result.output.trim() || "(nothing)"}`,
        );
      }
    }
  }
  for (const secret of secrets) {
    if (result.output.includes(secret)) {
      throw new Error("the refusal printed the value of a variable it was handed");
    }
  }
}

/** The plan is the expected list, in the expected order: names the first step that differs. */
export function expectDeployPlan(planned: readonly string[], expected: readonly string[]): void {
  for (let index = 0; index < Math.max(planned.length, expected.length); index += 1) {
    if (planned[index] !== expected[index]) {
      throw new Error(
        `the deploy plan differs at step ${index + 1}: expected \`${expected[index] ?? "(nothing)"}\`, planned \`${planned[index] ?? "(missing)"}\``,
      );
    }
  }
}

/** An app the plan deploys has a wrangler config it can deploy from, and a `deploy` script to run. */
export function expectDeployableApp(
  app: string,
  wrangler: string | undefined,
  manifest: string | undefined,
): void {
  if (wrangler === undefined) {
    throw new Error(`${app} is planned and has no wrangler.jsonc`);
  }
  let config: unknown;
  try {
    config = Bun.JSONC.parse(wrangler);
  } catch {
    throw new Error(`${app}/wrangler.jsonc is not valid JSONC`);
  }
  if (!isRecord(config) || typeof config.name !== "string" || config.name === "") {
    throw new Error(`${app}/wrangler.jsonc has no name`);
  }
  if (!isRecord(config.env) || !isRecord(config.env.production)) {
    throw new Error(`${app}/wrangler.jsonc has no env.production`);
  }
  if (manifest === undefined) {
    throw new Error(`${app} is planned and has no package.json`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(manifest);
  } catch {
    throw new Error(`${app}/package.json is not valid JSON`);
  }
  const scripts = isRecord(parsed) ? parsed.scripts : undefined;
  if (!isRecord(scripts) || typeof scripts.deploy !== "string") {
    throw new Error(`${app}/package.json has no deploy script`);
  }
}

/** An app of the project with a wrangler config that the plan leaves out would be a deploy nobody chose to skip. */
export function expectEveryAppPlanned(
  planned: readonly string[],
  withWrangler: readonly string[],
): void {
  const left = withWrangler.filter((app) => !planned.includes(app));
  if (left.length > 0) {
    throw new Error(`${left.join(", ")} has a wrangler.jsonc and is not planned`);
  }
  const bare = planned.filter((app) => !withWrangler.includes(app));
  if (bare.length > 0) {
    throw new Error(`${bare.join(", ")} is planned and has no wrangler.jsonc`);
  }
}

/**
 * The workflow as installed: it parses as YAML, runs on dispatch only, has the deploy job, every
 * `vp run <script>` it makes is a script of the project's root `package.json`, the one that deploys
 * included, and every local action it uses is one the project ships (`hasAction`; the setup is the
 * `pm` module's). `rootScripts` is what that file holds after the install, which is what the runner sees.
 */
export function expectWorkflow(
  text: string,
  rootScripts: readonly string[],
  hasAction: (path: string) => boolean,
): void {
  let workflow: unknown;
  try {
    workflow = Bun.YAML.parse(text);
  } catch {
    throw new Error(`${DEPLOY_WORKFLOW} is not valid YAML`);
  }
  if (!isRecord(workflow) || workflow.on !== "workflow_dispatch") {
    throw new Error(
      `${DEPLOY_WORKFLOW} has to run on workflow_dispatch only, it has \`on: ${JSON.stringify(isRecord(workflow) ? workflow.on : undefined)}\``,
    );
  }
  const jobs = isRecord(workflow.jobs) ? workflow.jobs : {};
  const runsOf = (job: unknown): string[] =>
    isRecord(job) && Array.isArray(job.steps)
      ? job.steps.flatMap((step: unknown) =>
          isRecord(step) && typeof step.run === "string" ? [step.run] : [],
        )
      : [];
  if (!isRecord(jobs.deploy)) {
    throw new Error(`${DEPLOY_WORKFLOW} has no deploy job`);
  }
  for (const run of Object.values(jobs).flatMap(runsOf)) {
    const script = /^vp run (\S+)/.exec(run)?.[1];
    if (script !== undefined && !rootScripts.includes(script)) {
      throw new Error(
        `${DEPLOY_WORKFLOW} runs \`vp run ${script}\`, and the project's package.json has no such script`,
      );
    }
  }
  const local = Object.values(jobs).flatMap((job) =>
    isRecord(job) && Array.isArray(job.steps)
      ? job.steps.flatMap((step: unknown) =>
          isRecord(step) && typeof step.uses === "string" && step.uses.startsWith("./")
            ? [step.uses]
            : [],
        )
      : [],
  );
  for (const action of local.filter((path) => !hasAction(path))) {
    throw new Error(`${DEPLOY_WORKFLOW} uses ${action}, and the project ships no such action`);
  }
  if (!runsOf(jobs.deploy).includes(`vp run ${DEPLOY_SCRIPT}`)) {
    throw new Error(
      `the deploy job of ${DEPLOY_WORKFLOW} does not run \`vp run ${DEPLOY_SCRIPT}\``,
    );
  }
}

/** `bonne-garde add` of a module on a provider it does not accept fails and names the provider that is installed. */
export function expectProviderRefusal(
  attempt: Attempt,
  module: string,
  allowed: string,
  installed: string,
): void {
  if (attempt.code === 0) {
    throw new Error(
      `\`bonne-garde add ${module}\` succeeded in a project on provider/${installed}: it accepts only ${allowed}, so it must be refused`,
    );
  }
  for (const named of [`accepts only ${allowed}`, `provider/${installed}`]) {
    if (!attempt.stderr.includes(named)) {
      throw new Error(
        `\`bonne-garde add ${module}\` was refused without saying \`${named}\`; it printed: ${attempt.stderr.trim() || "(nothing)"}`,
      );
    }
  }
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

/**
 * The tables a module adds to the schema barrel, which `db:generate` has to write into the migration
 * and D1 has to hold once it is applied. Auth's are read back by the seed phase, which clears and
 * inserts into them.
 */
export const MODULE_TABLES: Readonly<Record<string, readonly string[]>> = {
  "storage/r2": ["medias"],
};

/** What the migration has to create in a configuration: the table golden adds, and each module's own. */
export function expectedTables(configuration: Configuration): string[] {
  return [GOLDEN_TABLE, ...configuration.modules.flatMap((name) => MODULE_TABLES[name] ?? [])];
}

/** `db:seed` on a database that has the admin: it exits 0 and says it changed nothing. */
export function expectAlreadySeeded(stdout: string): void {
  if (!stdout.includes("Already seeded")) {
    throw new Error(`db:seed on a seeded database did not say it changed nothing:\n${stdout}`);
  }
}

/**
 * The tables the auth schema declares (`packages/auth/src/schema.ts`, which a test compares this with):
 * `db:seed` fills them, and `db:reset` has to empty them with everything else the barrel exports.
 */
export const AUTH_TABLES: readonly string[] = [
  "account",
  "invitation",
  "member",
  "organization",
  "session",
  "user",
  "verification",
];

/**
 * Every table `db:reset` has to leave empty in a configuration: the auth tables, the one golden adds to
 * the barrel, and each module's own. It is the orm's script, so it empties what the barrel exports and
 * not what a module lists, and this is what says the barrel exports each of them.
 */
export function resetTables(configuration: Configuration): string[] {
  return [...(hasAuth(configuration) ? AUTH_TABLES : []), ...expectedTables(configuration)];
}

/**
 * A media with the admin as its author and no organization. `medias.author_id` has no cascade, and
 * `organization_id` does: a media of an organization goes when the organization is deleted, so it never
 * stopped a reset that deleted organizations first. One with none stops the delete of its author, which
 * is what `auth`'s own reset ran into.
 */
export const GOLDEN_MEDIA_STATEMENT = `INSERT INTO medias (id, name, url, key, size, mime_type, author_id) SELECT 'golden-media', 'golden.png', 'http://localhost/golden.png', 'golden/golden.png', 1, 'image/png', id FROM "user" WHERE email = '${SEEDED_ADMIN}' LIMIT 1`;

/** A row in the table golden adds to the barrel, which no module owns: reset empties the project's tables too. */
export const GOLDEN_NOTE_STATEMENT = `INSERT INTO ${GOLDEN_TABLE} (body) VALUES ('golden')`;

/**
 * One query that counts the rows of every table, as one row with a column per table. A compound
 * `SELECT ... UNION ALL` would be shorter, and D1 refuses one of more than five terms.
 */
export function countStatement(tables: readonly string[]): string {
  return `SELECT ${tables.map((table) => `(SELECT count(*) FROM "${table}") AS "${table}"`).join(", ")}`;
}

/** The counts `countStatement` returned, by table. */
export function readCounts(rows: readonly Record<string, unknown>[]): Record<string, number> {
  const [row, ...others] = rows;
  if (row === undefined || others.length > 0) {
    throw new Error(`D1 gave ${rows.length} rows for the counts, expected one row`);
  }
  const counts: Record<string, number> = {};
  for (const [table, held] of Object.entries(row)) {
    if (typeof held !== "number") {
      throw new Error(`D1 gave no count for ${table}: ${JSON.stringify(held)}`);
    }
    counts[table] = held;
  }
  return counts;
}

/** Each table in `expected` holds that many rows: names every one that differs, and one that was not counted. */
export function expectRows(
  counts: Readonly<Record<string, number>>,
  expected: Readonly<Record<string, number>>,
): void {
  const wrong = Object.entries(expected).flatMap(([table, rows]) => {
    const held = counts[table];
    if (held === undefined) {
      return [`${table} was not counted`];
    }
    return held === rows ? [] : [`${table} holds ${held}, expected ${rows}`];
  });
  if (wrong.length > 0) {
    throw new Error(`D1 holds other rows than expected: ${wrong.join("; ")}`);
  }
}

/** The modules of every configuration, each once, in the order they first appear. */
export const MODULES: readonly string[] = [
  ...new Set(CONFIGURATIONS.flatMap((configuration) => configuration.modules)),
];

/** The item `refuse` tries with no ui module, and the module its refusal has to name. */
const REFUSED_ITEM = "button";
const REFUSED_MODULE = "ui/shadcn";

/**
 * The feature items: front-app source in `apps/spa/src/features`, which need the modules
 * their `meta.needsModules` names. A test pins this list to the registry's.
 */
export const FEATURE_ITEMS: readonly string[] = ["spa-auth", "spa-backoffice"];

/** The feature item `refuse` tries too, and the modules a project without any needs for it. */
export const REFUSED_FEATURE = "spa-auth";
const REFUSED_FEATURE_MODULES = [REFUSED_MODULE, "auth/better-auth", "web/spa"] as const;

/**
 * Projects that have every module a feature item needs but one: the refusal names that one alone, and
 * writes nothing. `modules` is what the project is given, `item` what is refused, `missing` what the
 * message has to name.
 */
export const FEATURE_REFUSALS: readonly {
  label: string;
  modules: readonly string[];
  item: string;
  missing: readonly string[];
}[] = [
  {
    label: "auth",
    modules: ["provider/cloudflare", "config/branding", "ui/shadcn", "api/elysia", "web/spa"],
    item: "spa-auth",
    missing: ["auth/better-auth"],
  },
  {
    label: "storage",
    modules: [
      "provider/cloudflare",
      "config/branding",
      "ui/shadcn",
      "api/elysia",
      "db/d1",
      "orm/drizzle",
      "auth/better-auth",
      "web/spa",
    ],
    item: "spa-backoffice",
    missing: ["storage/r2"],
  },
];

/**
 * Modules `bonne-garde list` shows that stay out of every configuration, each with its reason. An entry for
 * a module the registry no longer lists fails the run, as for `EXCLUDED`.
 */
export const EXCLUDED_MODULES: Readonly<Record<string, string>> = {
  "db/postgres":
    "installed by the dockerfile-postgres configuration once orm/drizzle has its postgres variant (stage 3 of BG-7)",
};

/**
 * The module ids to `bonne-garde add`, read from the `module` lines of `bonne-garde list` output
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
 * `bonne-garde add` reports exactly these as `applied` and, run again, as `skipped`: a module that gains or
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
    "auth/better-auth": [
      "dependencies.@app/auth",
      "dependencies.@app/auth",
      "elysia[app].use[authModule]",
      "exports[@app/auth/schema]",
      "imports[@app/auth]",
    ],
    "storage/r2": [
      "dependencies.@app/storage",
      "dependencies.@app/storage",
      "elysia[app].use[mediaModule]",
      "env.production.r2_buckets",
      "env.production.vars.R2_PUBLIC_URL",
      "exports[@app/storage/schema]",
      "imports[@app/storage]",
      "r2_buckets",
    ],
    "orm/drizzle": [
      "dependencies.@app/db",
      "dependencies.drizzle-orm",
      "dependencies.elysia",
      "devDependencies.drizzle-kit",
      "elysia[app].use[dbModule]",
      'exports."."',
      'exports."./reset"',
      'exports."./schema"',
      'exports."./testing"',
      "imports[@app/db]",
      "scripts.db:generate",
      "scripts.db:reset",
      "scripts.db:studio",
    ],
    "web/spa": ["env.production.vars.API_URL", "scripts.deploy", "scripts.dev", "vars.API_URL"],
    "web/ssr": ["env.production.vars.API_URL", "scripts.deploy", "scripts.dev", "vars.API_URL"],
    "web/static": ["scripts.deploy", "scripts.dev"],
    "dev/portless": [
      "devDependencies.portless",
      "scripts.dev:lan:portless",
      "scripts.dev:portless",
    ],
    // Not the import into mailer.ts: that is the intention's edit, and the file it edits is
    // region-checked by the `intent[<id>]` region `bonne-garde record` leaves.
    "email/resend": ["dependencies.@app/email"],
    "deploy/cloudflare-actions": ["devDependencies.jsonc-parser", "scripts.deploy:cloudflare"],
  },
  dockerfile: {
    "config/branding": ["scripts.gen:branding"],
    "api/elysia": ["scripts.dev"],
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
    ],
    "web/spa": ["scripts.dev"],
    "dev/portless": [
      "devDependencies.portless",
      "scripts.dev:lan:portless",
      "scripts.dev:portless",
    ],
  },
  fronts: {
    "config/branding": ["scripts.gen:branding"],
    "web/spa": ["scripts.deploy", "scripts.dev"],
    "web/ssr": ["scripts.deploy", "scripts.dev"],
    "web/static": ["scripts.deploy", "scripts.dev"],
    "deploy/cloudflare-actions": ["devDependencies.jsonc-parser", "scripts.deploy:cloudflare"],
  },
};

/**
 * The patches the feature items make: the `name@version` dependencies each writes into the
 * package.json of the app its files land in, one region each, owned by the item. A bare name is not one.
 * Golden checks that `bonne-garde add` reports exactly these as `applied` and, run again, as `skipped`.
 */
export const PATCHED_ITEMS: Readonly<Record<string, Readonly<Record<string, readonly string[]>>>> =
  {
    cloudflare: {
      "spa-auth": [
        "dependencies.@app/auth",
        "dependencies.@hookform/resolvers",
        "dependencies.better-auth",
        "dependencies.motion",
        "dependencies.react-hook-form",
        "dependencies.zod",
      ],
      "spa-backoffice": [
        "dependencies.@tanstack/react-form",
        "dependencies.@tanstack/react-pacer",
        "dependencies.@tanstack/react-table",
        "dependencies.@tanstack/react-virtual",
      ],
    },
    dockerfile: {},
  };

/** One patch of a module, as `bonne-garde add` prints it: its outcome and, per region, what it did. */
export type AddedPatch = {
  type: string;
  file: string;
  status: string;
  reason?: string;
  regions: { region: string; status: string }[];
};

/** A module `bonne-garde add` reported, with the commands it declares to validate itself and its patches. */
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
    throw new Error(
      `bonne-garde add printed a patch of ${module} without type, file, status and regions`,
    );
  }
  const regions = patch.regions.map((region: unknown) => {
    if (
      !isRecord(region) ||
      typeof region.region !== "string" ||
      typeof region.status !== "string"
    ) {
      throw new Error(
        `bonne-garde add printed a region of a patch of ${module} without region and status`,
      );
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
 * The modules in the JSON `bonne-garde add` prints, which is where the packed CLI says what it installed
 * and what each module checks: `add` prints those commands and does not run them. Fails when a
 * module in `expected` is not among them.
 */
export function readAddedModules(stdout: string, expected: readonly string[]): AddedModule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bonne-garde add did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.modules)) {
    throw new Error("bonne-garde add printed no `modules` array");
  }
  const added = parsed.modules.map((entry: unknown): AddedModule => {
    if (!isRecord(entry) || typeof entry.module !== "string") {
      throw new Error("bonne-garde add printed a module with no `module` key");
    }
    const checks = entry.checks ?? [];
    if (!isStringArray(checks)) {
      throw new Error(
        `bonne-garde add printed \`checks\` of ${entry.module} that is not a list of strings`,
      );
    }
    const patches = entry.patches ?? [];
    if (!Array.isArray(patches)) {
      throw new Error(`bonne-garde add printed \`patches\` of ${entry.module} that is not a list`);
    }
    const { module } = entry;
    return { module, checks, patches: patches.map((patch) => readPatch(module, patch)) };
  });
  const missing = expected.filter((name) => !added.some(({ module }) => module === name));
  if (missing.length > 0) {
    throw new Error(`bonne-garde add did not report ${missing.join(", ")}`);
  }
  return added;
}

/**
 * The dependencies the items added, in the `itemPatches` `bonne-garde add` prints, shaped as the modules' are
 * (an item is the owner of its regions) so `expectPatches` and `expectRegionsRecorded` read both alike.
 */
export function readAddedItems(stdout: string): AddedModule[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bonne-garde add did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.itemPatches)) {
    throw new Error("bonne-garde add printed no `itemPatches` array");
  }
  const byItem = new Map<string, AddedPatch[]>();
  for (const entry of parsed.itemPatches as unknown[]) {
    if (!isRecord(entry) || typeof entry.item !== "string") {
      throw new Error("bonne-garde add printed an item patch with no `item` key");
    }
    const { item, ...patch } = entry;
    byItem.set(item, [...(byItem.get(item) ?? []), readPatch(item, patch)]);
  }
  return [...byItem].map(([module, patches]) => ({ module, checks: [], patches }));
}

/**
 * A failed patch is never silent, and a re-add finds every region present and equal.
 * Checks every patch `bonne-garde add` reported against `status`, and the regions of each module against
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
 * The regions `bonne-garde add` reported must be in `bg.json` under `regions`, owned by the module that
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
            `bg.json records ${region} of ${file} for ${String(owner)}, and bonne-garde add reported it for ${module}`,
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

/**
 * Every file of a project, `node_modules` and `.git` left out: `bg.json` as text, which `diffTrees` settles,
 * and any other by the sha256 of its bytes. Decoded as text, two icons that differ by an invalid byte
 * read the same, and a re-add that changed one would pass for a re-add that changed nothing.
 */
export async function snapshot(root: string): Promise<Record<string, string>> {
  const tree: Record<string, string> = {};
  for await (const path of new Bun.Glob("**/*").scan({ cwd: root, dot: true, onlyFiles: true })) {
    if (!/^(?:node_modules|\.git)\//.test(path)) {
      const file = Bun.file(join(root, path));
      tree[path] = path === "bg.json" ? await file.text() : sha256(await file.bytes());
    }
  }
  return tree;
}

/**
 * The argv of the one `bonne-garde add` golden runs per configuration: every module, then every item the
 * configuration has. One call, so a module and the items that need it are planned together, and never
 * `--force`: two installs that write the same file have to fail here and not be settled by an
 * overwrite. A name given twice, and no module, fail, so a broken `bonne-garde list` is not a green run (an
 * empty item list is `selectItems`'s to refuse: a configuration may have none).
 */
export function addArguments(modules: readonly string[], items: readonly string[]): string[] {
  if (modules.length === 0) {
    throw new Error("no modules to add");
  }
  const names = [...modules, ...items];
  const twice = names.filter((name, index) => names.indexOf(name) !== index);
  if (twice.length > 0) {
    throw new Error(`named twice in one \`bonne-garde add\`: ${[...new Set(twice)].join(", ")}`);
  }
  return ["add", ...names, "--yes", "--no-install"];
}

const sha256 = (bytes: Uint8Array): string => createHash("sha256").update(bytes).digest("hex");

/** Where `config/branding` puts the favicons in a project. */
export const FAVICONS_DIR = "packages/config/assets/favicons";

/**
 * The favicons that are binary template files: the first the registry ships. `favicon.svg` and
 * `site.webmanifest` are text, and the project holds those like any other file.
 */
export const BINARY_FAVICONS = [
  "android-chrome-192x192.png",
  "android-chrome-512x512.png",
  "apple-touch-icon.png",
  "favicon-16x16.png",
  "favicon-32x32.png",
  "favicon-48x48.png",
  "favicon.ico",
] as const;

/** Whether the configuration installs the favicons and the SPA that serves them, so golden reads them in the build. */
export function hasFavicons(configuration: Configuration): boolean {
  return (
    configuration.modules.includes("config/branding") && configuration.modules.includes("web/spa")
  );
}

/**
 * Each binary favicon of the project is the registry's, byte for byte, and `bg.json` records the sha256 of
 * those bytes: the file survived the transport, and what `doctor` hashes is what was written. Names every
 * favicon that is not, so one run shows them all.
 */
export async function expectFaviconsIdentical(registry: string, project: string): Promise<void> {
  const manifest: unknown = JSON.parse(await Bun.file(join(project, "bg.json")).text());
  const recorded = isRecord(manifest) && isRecord(manifest.files) ? manifest.files : {};
  const problems: string[] = [];
  for (const name of BINARY_FAVICONS) {
    const path = `${FAVICONS_DIR}/${name}`;
    const written = Bun.file(join(project, path));
    if (!(await written.exists())) {
      problems.push(`${path} is missing from the project`);
      continue;
    }
    const actual = sha256(await written.bytes());
    const expected = sha256(
      await Bun.file(join(registry, "modules/config/branding/template", path)).bytes(),
    );
    if (actual !== expected) {
      problems.push(`${path} differs from the registry's: sha256 ${actual}, expected ${expected}`);
    }
    const record = recorded[path];
    const sha = isRecord(record) ? record.sha256 : undefined;
    if (sha === undefined) {
      problems.push(`bg.json records no sha256 for ${path}`);
    } else if (sha !== actual) {
      problems.push(
        `bg.json records sha256 ${String(sha)} for ${path}, and the file's is ${actual}`,
      );
    }
  }
  if (problems.length > 0) {
    throw new Error(problems.join("; "));
  }
}

/**
 * The `href` of the manifest a built `index.html` links, which has to be a root URL: a `data:` URL is what
 * Vite makes of a manifest it bundles, and no path in it, the icons' included, resolves against it.
 */
export function manifestHref(html: string): string {
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    if (!/\brel="manifest"/.test(tag)) {
      continue;
    }
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (href === undefined || href.startsWith("data:")) {
      throw new Error(
        `index.html links its manifest as ${href === undefined ? "nothing" : "a data: URL"}, not as a file of the build`,
      );
    }
    if (!href.startsWith("/")) {
      throw new Error(`index.html links its manifest as ${href}, which is not a root URL`);
    }
    return href;
  }
  throw new Error("index.html links no manifest");
}

/** The path of the build that each icon of a web manifest names, resolved against the manifest's own URL as a browser does. */
export function manifestIconPaths(manifest: string, href: string): string[] {
  const parsed: unknown = JSON.parse(manifest);
  const icons = isRecord(parsed) && Array.isArray(parsed.icons) ? parsed.icons : [];
  if (icons.length === 0) {
    throw new Error(`the manifest ${href} names no icons`);
  }
  const origin = "http://site.test";
  return icons.map((icon: unknown) => {
    const src = isRecord(icon) ? icon.src : undefined;
    if (typeof src !== "string") {
      throw new Error(`an icon of the manifest ${href} has no src`);
    }
    const url = new URL(src, `${origin}${href}`);
    if (url.origin !== origin) {
      throw new Error(`the icon ${src} of the manifest ${href} is not a path of the build`);
    }
    return url.pathname;
  });
}

/**
 * The built client (`build/client`) serves what its `index.html` links: the manifest is a file of it, and every
 * icon the manifest names is one too. With `source`, the favicons directory it was copied from, each icon is
 * also that file byte for byte. Names every icon the build lacks, and returns the paths of the icons.
 */
export async function expectManifestEmitted(client: string, source?: string): Promise<string[]> {
  const href = manifestHref(await Bun.file(join(client, "index.html")).text());
  const manifest = Bun.file(join(client, href));
  if (!(await manifest.exists())) {
    throw new Error(`the manifest ${href} is not in the build`);
  }
  const icons = manifestIconPaths(await manifest.text(), href);
  const problems: string[] = [];
  for (const icon of icons) {
    const built = Bun.file(join(client, icon));
    if (!(await built.exists())) {
      problems.push(`${icon} is not in the build`);
      continue;
    }
    const name = icon.split("/").pop() ?? icon;
    if (
      source !== undefined &&
      sha256(await built.bytes()) !== sha256(await Bun.file(join(source, name)).bytes())
    ) {
      problems.push(`${name} of the build differs from ${join(source, name)}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(
      `the manifest ${href} names icons the build does not serve: ${problems.join("; ")}`,
    );
  }
  return icons;
}

/** The web shells that serve the favicons: `web/<shell>` is the module that ships each. */
const FAVICON_SHELLS = ["spa", "ssr", "static"] as const;
export type FaviconShell = (typeof FAVICON_SHELLS)[number];

/** The shells of the configuration that serve the favicons: the ones it installs, once it installs the module that ships them. */
export function faviconShells(configuration: Configuration): FaviconShell[] {
  if (!configuration.modules.includes("config/branding")) {
    return [];
  }
  return FAVICON_SHELLS.filter((shell) => configuration.modules.includes(`web/${shell}`));
}

/** What a page links to name its icons and its manifest. */
const FAVICON_RELS = new Set(["icon", "apple-touch-icon", "manifest"]);

/**
 * The `href` of every `<link>` of a page that is an icon or the manifest. Each has to be a root URL: a
 * `data:` URL is what Vite makes of a file it bundles, and no path in it, a manifest's icons included, resolves.
 */
export function faviconHrefs(html: string): string[] {
  const hrefs: string[] = [];
  for (const [tag] of html.matchAll(/<link\b[^>]*>/g)) {
    const rel = /\brel="([^"]*)"/.exec(tag)?.[1];
    if (rel === undefined || !FAVICON_RELS.has(rel)) {
      continue;
    }
    const href = /\bhref="([^"]*)"/.exec(tag)?.[1];
    if (href === undefined) {
      throw new Error(`a <link rel="${rel}"> of the page has no href`);
    }
    if (href.startsWith("data:")) {
      throw new Error(`the page links its ${rel} as a data: URL, not as a file of the build`);
    }
    if (!href.startsWith("/")) {
      throw new Error(`the page links its ${rel} as ${href}, which is not a root URL`);
    }
    hrefs.push(href);
  }
  if (hrefs.length === 0) {
    throw new Error("the page links no favicon");
  }
  return hrefs;
}

/** What of `names` the `client` build lacks or holds other than as `source` has it, byte for byte, each as a sentence. */
async function unbuilt(
  client: string,
  source: string,
  names: readonly string[],
): Promise<string[]> {
  const problems: string[] = [];
  for (const name of names) {
    const built = Bun.file(join(client, name));
    if (!(await built.exists())) {
      problems.push(`${name} is not in the build`);
    } else if (sha256(await built.bytes()) !== sha256(await Bun.file(join(source, name)).bytes())) {
      problems.push(`${name} of the build differs from ${join(source, name)}`);
    }
  }
  return problems;
}

/**
 * The built client holds every file of the favicons directory under its own name, byte for byte: the
 * manifest and the icons it names, and the ones the page links and the manifest does not. Names each it
 * lacks or changed, and returns the names.
 */
export async function expectBuildHoldsFavicons(client: string, source: string): Promise<string[]> {
  const names = (await readdir(source)).sort();
  const problems = await unbuilt(client, source, names);
  if (problems.length > 0) {
    throw new Error(`the build does not hold the favicons of ${source}: ${problems.join("; ")}`);
  }
  return names;
}

/** The files under `dir`, relative to it, sorted; none when `dir` does not exist. */
async function filesUnder(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { recursive: true, withFileTypes: true }).catch(
    (error: unknown) => {
      if (isRecord(error) && error.code === "ENOENT") {
        return [];
      }
      throw error;
    },
  );
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .sort();
}

/**
 * The app's own `public/` is in its build next to the favicons: Vite takes one `publicDir`, which is why
 * the favicons are not it. Names each file of `public/` the build lacks or changed, and returns them.
 */
export async function expectOwnPublicKept(app: string): Promise<string[]> {
  const source = join(app, "public");
  const names = await filesUnder(source);
  const problems = await unbuilt(join(app, "build/client"), source, names);
  if (problems.length > 0) {
    throw new Error(`the build does not hold the files of ${source}: ${problems.join("; ")}`);
  }
  return names;
}

/**
 * An app that answers over HTTP at `origin` links the manifest and the icons as root URLs and serves each as
 * the file `source` holds: the manifest as `application/manifest+json`, the icons it names as `image/png`,
 * the other links with a 200. Returns the paths it asked for.
 */
export async function expectFaviconsServed(origin: string, source: string): Promise<string[]> {
  const get = async (path: string) => {
    const response = await fetch(`${origin}${path}`, { signal: AbortSignal.timeout(5000) });
    return {
      served: { status: response.status, contentType: response.headers.get("content-type") },
      bytes: await response.bytes(),
    };
  };
  const html = new TextDecoder().decode((await get("/")).bytes);
  const links = faviconHrefs(html);
  const manifestUrl = manifestHref(html);
  const manifest = await get(manifestUrl);
  expectServed(`GET ${manifestUrl}`, manifest.served, 200, "application/manifest+json");
  const icons = manifestIconPaths(new TextDecoder().decode(manifest.bytes), manifestUrl);

  const paths = [...new Set([...links, ...icons])];
  const problems: string[] = [];
  for (const path of paths) {
    const { served, bytes } = await get(path);
    if (icons.includes(path)) {
      expectServed(`GET ${path}`, served, 200, "image/png");
    } else if (served.status !== 200) {
      throw new Error(`GET ${path}: expected 200, got ${served.status}`);
    }
    const file = join(source, path.split("/").pop() ?? path);
    if (sha256(bytes) !== sha256(await Bun.file(file).bytes())) {
      problems.push(`${path} differs from ${file}`);
    }
  }
  if (problems.length > 0) {
    throw new Error(`the app serves favicons other than the project's: ${problems.join("; ")}`);
  }
  return paths;
}

/** The module whose package is `<scope>/email`, whose tests golden counts. */
const EMAIL_MODULE = "email/resend";

/** Whether the configuration installs email, so golden counts its tests and resolves what it wires. */
export function hasEmail(configuration: Configuration): boolean {
  return configuration.modules.includes(EMAIL_MODULE);
}

/** How many tests the email package runs in the project; fewer means the root `test` stopped reaching it. */
export const EMAIL_MIN_TESTS = 19;

/** The file auth documents as the one place an email module wires itself in, and the proof golden adds beside it. */
export const MAILER_FILE = "packages/auth/src/mailer.ts";
const WIRED_TEST_FILE = "packages/auth/src/mailer.wired.test.ts";

/**
 * The intentions `bonne-garde add` leaves pending, per configuration: what the variants it
 * selects ship. Golden resolves each the way an executor would, and a configuration that gains one is a
 * decision made here. The dockerfile project has no auth, so email selects the variant that wires nothing
 * and nothing is pending: it installs cleanly and `doctor --strict` is green as it is.
 */
export const PENDING: Readonly<Record<string, readonly string[]>> = {
  cloudflare: ["email/resend/wire-email-into-auth"],
  dockerfile: [],
  fronts: [],
};

/** The ids in the `pendingIntentions` list `bonne-garde add` prints. */
export function readPendingIntentions(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bonne-garde add did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.pendingIntentions)) {
    throw new Error("bonne-garde add printed no `pendingIntentions` array");
  }
  return parsed.pendingIntentions.map((entry: unknown) => {
    if (!isRecord(entry) || typeof entry.id !== "string") {
      throw new Error("bonne-garde add printed a pending intention without an id");
    }
    return entry.id;
  });
}

/** The pending intentions are the ones golden expects: no more, which would be unresolved work, and no fewer. */
export function expectPending(reported: readonly string[], expected: readonly string[]): void {
  if (JSON.stringify([...reported].sort()) !== JSON.stringify([...expected].sort())) {
    throw new Error(
      `bonne-garde add left pending [${reported.join(", ")}], golden expects [${expected.join(", ")}]`,
    );
  }
}

/** A module `bonne-garde add` planned again though the command did not name it: the variant it left and the one it took. */
export type Reselected = { module: string; from: string; to: string };

/** The modules in the `reselected` list `bonne-garde add` prints. */
export function readReselected(stdout: string): Reselected[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bonne-garde add did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.reselected)) {
    throw new Error("bonne-garde add printed no `reselected` array");
  }
  return parsed.reselected.map((entry: unknown) => {
    if (
      !isRecord(entry) ||
      typeof entry.module !== "string" ||
      typeof entry.from !== "string" ||
      typeof entry.to !== "string"
    ) {
      throw new Error("bonne-garde add printed a reselected module without module, from and to");
    }
    return { module: entry.module, from: entry.from, to: entry.to };
  });
}

/** The modules planned again are the ones golden expects: no more, which would be an add that touches what it was not asked to, and no fewer. */
export function expectReselected(
  reported: readonly Reselected[],
  expected: readonly Reselected[],
): void {
  const show = (list: readonly Reselected[]) =>
    list.map(({ module, from, to }) => `${module} ${from} -> ${to}`).join(", ");
  if (JSON.stringify(reported) !== JSON.stringify(expected)) {
    throw new Error(
      `bonne-garde add planned again [${show(reported)}], golden expects [${show(expected)}]`,
    );
  }
}

/**
 * The other order: email installed first, so on the variant that wires nothing, then
 * auth, whose install has to plan email again on the variant that matches it. The configurations
 * install auth first, which is the order 035 gives, so this has a project of its own.
 */
export const RESELECT_BASE: readonly string[] = [...WITHOUT_ORM, "orm/drizzle", "email/resend"];
export const RESELECTED: Reselected = { module: EMAIL_MODULE, from: "default", to: "better-auth" };

/**
 * The edit `email/resend/wire-email-into-auth` describes, as an executor makes it: `mailer` becomes
 * `emailMailer`, imported from the email package in place of the import of the logger that only the old
 * initializer used. `bonne-garde add` imports nothing into `mailer.ts`: the whole edit is the intention's. It fails,
 * naming what it looked for, when auth ships something else or the edit was made already, so a seam that
 * moved is not edited blind.
 */
export function wireEmailIntoAuth(source: string, scope: string): string {
  const initializer = "export const mailer: AuthMailer = unconfiguredMailer(apiLogger);";
  const logger = `import { logger as apiLogger } from "${scope}/api/lib/logger";\n`;
  for (const looked of [initializer, logger.trimEnd()]) {
    if (!source.includes(looked)) {
      throw new Error(`${MAILER_FILE} has no \`${looked}\`: the intention describes another file`);
    }
  }
  return source
    .replace(initializer, "export const mailer: AuthMailer = emailMailer;")
    .replace(logger, `import { emailMailer } from "${scope}/email";\n`);
}

/**
 * The Validation of that intention: a test in `packages/auth` that runs auth's own flows with the
 * `mailer` auth exports, and reads what the email package delivered. It is the wiring that is proved
 * (auth's `mailer` is the email module's, so a sign-up sends the verification email and a reset request
 * sends the reset one, each with a link that works), not the email package, which has tests of its own.
 */
export function wiredTest(scope: string): string {
  return `import { beforeEach, expect, test } from "vite-plus/test";
import { clearOutbox, outbox } from "${scope}/email/testing";
import { mailer } from "./mailer";
import { createTestAuth } from "./testing";

const PASSWORD = "correct horse battery staple";

beforeEach(clearOutbox);

/** The link of the page the email opens: the first href of the html that was sent. */
function linkOf(html: string): URL {
  return new URL(/href="([^"]+)"/.exec(html)?.[1] ?? "");
}

async function signUpAndVerify(email: string) {
  const { auth, call } = await createTestAuth({ mailer });
  const signUp = await call("/sign-up/email", { body: { email, password: PASSWORD, name: "Ada" } });
  expect(signUp.status).toBe(200);
  expect(outbox.map(({ to, subject }) => [to, subject])).toEqual([
    [email, "Verify your email address"],
  ]);
  const link = linkOf(outbox[0]?.html ?? "");
  expect(link.origin + link.pathname).toBe("http://spa.test/auth/verify-email");
  await auth.api.verifyEmail({ query: { token: link.searchParams.get("token") ?? "" } });
  return { call };
}

test("a sign-up is sent the verification email, and its link verifies the user", async () => {
  const { call } = await signUpAndVerify("ada@example.com");

  const signIn = await call("/sign-in/email", {
    body: { email: "ada@example.com", password: PASSWORD },
  });
  expect(signIn.status).toBe(200);
});

test("a password reset request is sent the reset email, with the page that takes the token", async () => {
  const { call } = await signUpAndVerify("grace@example.com");
  clearOutbox();

  const reset = await call("/request-password-reset", { body: { email: "grace@example.com" } });

  expect(reset.status).toBe(200);
  expect(outbox.map(({ to, subject }) => [to, subject])).toEqual([
    ["grace@example.com", "Reset your password"],
  ]);
  const link = linkOf(outbox[0]?.html ?? "");
  expect(link.origin + link.pathname).toBe("http://spa.test/auth/reset-password");
  expect(link.searchParams.get("token")).toBeTruthy();
});
`;
}

/**
 * How golden resolves an intention the way an executor does: applies the edit its document
 * describes, and adds the test its Validation names. Recording it is the caller's, once the project's
 * typecheck and tests, which run that test, have passed.
 */
export type Resolution = {
  /** The module that ships the intention, whose `bonne-garde add` stages it and whose region `bonne-garde record` leaves. */
  module: string;
  /** The module that owns the file the edit lands in: it has to survive its own re-add. */
  editedOwner: string;
  /** The file the edit lands in, which the intention declares `adapt`. */
  file: string;
  apply(project: string): Promise<void>;
};

export const RESOLUTIONS: Readonly<Record<string, Resolution>> = {
  "email/resend/wire-email-into-auth": {
    module: "email/resend",
    editedOwner: "auth/better-auth",
    file: MAILER_FILE,
    async apply(project) {
      const file = join(project, MAILER_FILE);
      await Bun.write(file, wireEmailIntoAuth(await Bun.file(file).text(), SCOPE));
      await Bun.write(join(project, WIRED_TEST_FILE), wiredTest(SCOPE));
    },
  },
};

/** The way to resolve a pending intention: one golden does not know is a failed run, not a skipped one. */
function resolution(id: string): Resolution {
  const found = Object.hasOwn(RESOLUTIONS, id) ? RESOLUTIONS[id] : undefined;
  if (found === undefined) {
    throw new Error(
      `${id} is pending and golden does not know how to resolve it: add it to RESOLUTIONS`,
    );
  }
  return found;
}

/** The region `bonne-garde record` leaves on a file an intention edited: `intent[<id>]`, spelled out here as a consumer reads it. */
export function intentRegion(id: string): string {
  return `intent[${id}]`;
}

function regionsOf(manifest: unknown): Record<string, unknown> {
  if (!isRecord(manifest) || !isRecord(manifest.regions)) {
    throw new Error("bg.json has no `regions` object");
  }
  return manifest.regions;
}

/**
 * After `bonne-garde record`, `bg.json` holds the intention's region on the file it edited, owned by the module
 * that ships it. That region is what makes `doctor --strict` read the edit as the project's, and what
 * makes the owner's re-add keep it: a recorded sha would have the owner overwrite it.
 */
export function expectIntentRegion(
  manifest: unknown,
  id: string,
  file: string,
  owner: string,
): void {
  const owned = regionsOf(manifest)[file];
  const found = isRecord(owned) ? owned[intentRegion(id)] : undefined;
  if (found === undefined) {
    throw new Error(
      `bg.json records no ${intentRegion(id)} on ${file} after \`bonne-garde record ${id}\``,
    );
  }
  if (found !== owner) {
    throw new Error(
      `bg.json records ${intentRegion(id)} on ${file} for ${String(found)}, and the intention is ${owner}'s`,
    );
  }
}

/** Before `bonne-garde record`, no file carries the region: it is what the record leaves, never what an add does. */
export function expectNoIntentRegion(manifest: unknown, id: string): void {
  for (const [file, owned] of Object.entries(regionsOf(manifest))) {
    if (isRecord(owned) && Object.hasOwn(owned, intentRegion(id))) {
      throw new Error(
        `bg.json already records ${intentRegion(id)} on ${file}, before \`bonne-garde record\``,
      );
    }
  }
}

/** The files `bonne-garde add` printed under `kept`: left as the project has them, since they carry recorded regions. */
export function readKept(stdout: string): string[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("bonne-garde add did not print JSON");
  }
  if (!isRecord(parsed) || !isStringArray(parsed.kept)) {
    throw new Error("bonne-garde add printed no `kept` list");
  }
  return parsed.kept;
}

/** The re-add of the owner of an edited file kept it: with the region recorded, only regions are classified. */
export function expectKept(stdout: string, file: string): void {
  if (!readKept(stdout).includes(file)) {
    throw new Error(
      `bonne-garde add did not keep ${file}: the edit an intention made to it is the project's`,
    );
  }
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
 * Vitest colours that line when `CI` is set, so the colours are stripped first.
 */
export function testCounts(output: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const line of stripVTControlCharacters(output).split("\n")) {
    const [, workspace, ran] = /^\[(\S+)#test\]\s+Tests\s+(\d+) passed/.exec(line) ?? [];
    if (workspace !== undefined && ran !== undefined) {
      counts[workspace] = Number(ran);
    }
  }
  return counts;
}

/** How many tests the auth package runs in the project; fewer means the root `test` stopped reaching it. */
export const AUTH_MIN_TESTS = 53;

/**
 * How many tests the storage package runs in the project: the legacy media tests (r2, routes, e2e)
 * ported, and the ones the extraction added. Fewer means the root `test` stopped reaching them.
 */
export const STORAGE_MIN_TESTS = 75;

/** Whether the configuration installs the feature items, which need the auth module. */
export function hasFeatures(configuration: Configuration): boolean {
  return configuration.items && hasAuth(configuration);
}

/** The shell's own tests in the spa: the home page, and the composed route table (3). */
export const SPA_SHELL_MIN_TESTS = 4;

/** What the features add to them: `spa-auth`'s validation tests. */
export const SPA_FEATURE_MIN_TESTS = 4;

/** How many tests the spa runs in a configuration; fewer means the root `test` stopped reaching it. */
export function spaMinTests(configuration: Configuration): number {
  return SPA_SHELL_MIN_TESTS + (hasFeatures(configuration) ? SPA_FEATURE_MIN_TESTS : 0);
}

/** The workspace ran at least `atLeast` tests: a workspace the root `test` skipped would otherwise pass in silence. */
export function expectRan(
  counts: Readonly<Record<string, number>>,
  workspace: string,
  atLeast: number,
): void {
  const ran = counts[workspace];
  if (ran === undefined || ran < atLeast) {
    throw new Error(`${workspace} ran ${ran ?? 0} tests, expected at least ${atLeast}`);
  }
}

/** The module whose launcher golden counts the tests of and asks for its plan. */
const PORTLESS_MODULE = "dev/portless";

/** Whether the configuration installs the launcher, so golden runs its tests and prints its plan. */
export function hasPortless(configuration: Configuration): boolean {
  return configuration.modules.includes(PORTLESS_MODULE);
}

/**
 * How many tests the launcher runs in the project (`vp test scripts/dev-portless.test.ts`: it is a
 * root script, so the root `test` fan-out over workspaces never reaches it); fewer means they went.
 */
export const PORTLESS_MIN_TESTS = 36;

/** The count in the `Tests  N passed` line of the summary Vitest prints, colored or not. */
export function ranTests(output: string): number {
  const ran = /^\s*Tests\s+(\d+) passed/m.exec(stripVTControlCharacters(output))?.[1];
  if (ran === undefined) {
    throw new Error(`vp test printed no \`Tests N passed\` line: ${output.trim() || "(nothing)"}`);
  }
  return Number(ran);
}

/**
 * One app of the launcher's plan, as golden expects it: its directory, its portless name and the
 * command, and whether it is a Worker or a Pages project that a Vite command runs, which has to be
 * told to read the URLs from its process environment.
 */
export type ExpectedPortlessApp = {
  dir: string;
  name: string;
  cmd: string[];
  includesProcessEnv?: true;
};

/**
 * What `scripts/dev-portless.ts --dry-run` has to plan in a configuration, written out by hand and not
 * by the launcher's own rules, for a project whose root package is `slug` and a proxy serving `tld`: the
 * apps the modules install, and for each the command that follows from its `dev` script. The Worker API
 * runs through wrangler with the free port and every sibling's URL, the container's API reads PORT, and a front
 * runs `react-router dev` as it is, which portless recognises by name. The fronts of a configuration on the
 * cloudflare provider each have a wrangler config, so each is told `CLOUDFLARE_INCLUDE_PROCESS_ENV`: the Cloudflare
 * Vite plugin ignores the process environment otherwise, and `ssr` would keep the `localhost` API_URL of its config.
 */
export function expectedPortlessApps(
  configuration: string,
  slug: string,
  tld: string,
): ExpectedPortlessApp[] {
  const app = (dir: string, run: readonly string[]): ExpectedPortlessApp => ({
    dir,
    name: `${dir}.${slug}`,
    cmd: ["portless", "run", "--name", `${dir}.${slug}`, ...run],
  });
  const url = (dir: string) => `https://${dir}.${slug}.${tld}`;
  const front = (dir: string): ExpectedPortlessApp => ({
    ...app(dir, ["react-router", "dev"]),
    ...(ANSWER_SETS[configuration]?.provider === "cloudflare"
      ? { includesProcessEnv: true as const }
      : {}),
  });

  if (configuration === "cloudflare") {
    return [
      app("api", [
        "sh",
        "-c",
        'exec wrangler dev --port "$PORT" "$@"',
        "wrangler",
        "--var",
        `API_URL:${url("api")}`,
        "--var",
        `SPA_URL:${url("spa")}`,
        "--var",
        `SSR_URL:${url("ssr")}`,
        "--var",
        `STATIC_URL:${url("static")}`,
      ]),
      front("spa"),
      front("ssr"),
      front("static"),
    ];
  }
  if (configuration === "dockerfile") {
    return [app("api", ["tsx", "watch", "src/index.ts"]), front("spa")];
  }
  throw new Error(`golden does not know what the launcher plans in ${configuration}`);
}

type PlannedPortlessApp = ExpectedPortlessApp & {
  url: string;
  cwd: string;
  env: Record<string, string>;
};

/** The apps in the JSON `bun scripts/dev-portless.ts --dry-run` prints. */
function readPortlessPlan(stdout: string): PlannedPortlessApp[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout);
  } catch {
    throw new Error("dev-portless --dry-run did not print JSON");
  }
  if (!isRecord(parsed) || !Array.isArray(parsed.apps)) {
    throw new Error("dev-portless --dry-run printed no `apps` list");
  }
  return parsed.apps.map((entry: unknown): PlannedPortlessApp => {
    if (
      !isRecord(entry) ||
      typeof entry.dir !== "string" ||
      typeof entry.name !== "string" ||
      typeof entry.url !== "string" ||
      typeof entry.cwd !== "string" ||
      !isStringArray(entry.cmd) ||
      !isRecord(entry.env)
    ) {
      throw new Error(
        "dev-portless --dry-run printed an app without dir, name, url, cwd, cmd and env",
      );
    }
    const env = Object.fromEntries(
      Object.entries(entry.env).flatMap(([key, value]) =>
        typeof value === "string" ? [[key, value]] : [],
      ),
    );
    return {
      dir: entry.dir,
      name: entry.name,
      url: entry.url,
      cwd: entry.cwd,
      cmd: entry.cmd,
      env,
    };
  });
}

/**
 * The launcher's dry run planned exactly the apps `expected` names, each with the name, the address under
 * `tld`, the directory and the command golden expects, and told every app but the API where the API is
 * (`API_URL` and `VITE_API_URL`: a Worker is told through `--var`, which the command carries). An app with a
 * wrangler config that a Vite command runs is told `CLOUDFLARE_INCLUDE_PROCESS_ENV=true`, and no other app is.
 */
export function expectPortlessPlan(
  stdout: string,
  expected: readonly ExpectedPortlessApp[],
  tld: string,
): void {
  const planned = readPortlessPlan(stdout);
  const dirs = planned.map(({ dir }) => dir);
  const missing = expected.filter(({ dir }) => !dirs.includes(dir)).map(({ dir }) => dir);
  const unexpected = dirs.filter((dir) => !expected.some((app) => app.dir === dir));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `dev-portless planned [${dirs.join(", ")}], golden expects [${expected.map(({ dir }) => dir).join(", ")}]` +
        (missing.length > 0 ? `; it did not plan ${missing.join(", ")}` : "") +
        (unexpected.length > 0
          ? `; it planned ${unexpected.join(", ")}, which golden did not expect`
          : ""),
    );
  }
  for (const want of expected) {
    const got = planned.find(({ dir }) => dir === want.dir);
    if (got === undefined) {
      continue;
    }
    if (got.name !== want.name || got.cwd !== `apps/${want.dir}`) {
      throw new Error(
        `${want.dir}: planned name ${got.name} in ${got.cwd}, expected ${want.name} in apps/${want.dir}`,
      );
    }
    if (got.url !== `https://${want.name}.${tld}`) {
      throw new Error(`${want.dir}: planned url ${got.url}, expected https://${want.name}.${tld}`);
    }
    if (JSON.stringify(got.cmd) !== JSON.stringify(want.cmd)) {
      throw new Error(
        `${want.dir}: planned \`${got.cmd.join(" ")}\`, expected \`${want.cmd.join(" ")}\``,
      );
    }
  }
  const api = planned.find(({ dir }) => dir === "api");
  for (const app of api === undefined ? [] : planned.filter(({ dir }) => dir !== "api")) {
    for (const key of ["API_URL", "VITE_API_URL"]) {
      if (app.env[key] !== api?.url) {
        throw new Error(
          `${app.dir}: ${key} is ${app.env[key] ?? "not set"}, expected the API's ${api?.url}`,
        );
      }
    }
  }
  for (const want of expected) {
    const includes =
      planned.find(({ dir }) => dir === want.dir)?.env.CLOUDFLARE_INCLUDE_PROCESS_ENV === "true";
    if (includes !== (want.includesProcessEnv === true)) {
      throw new Error(
        `${want.dir}: CLOUDFLARE_INCLUDE_PROCESS_ENV is ${includes ? "set" : "not set"}, expected it ${want.includesProcessEnv === true ? "set" : "not set"}`,
      );
    }
  }
}

/** How a command ended, for one that is expected to fail. */
export type Attempt = { code: number; stderr: string };

/**
 * An item that lands in `packages/ui` is refused until a `ui` module is named, and one that lands in an
 * app's `features` folder until an `auth` module is. Golden tries each with the packed CLI in a
 * project that has none, before installing anything: the refusal has to carry the command that fixes
 * it, every missing module in it, as an agent running `bonne-garde add` reads it and nothing else.
 */
export function expectRefusal(attempt: Attempt, item: string, ...modules: string[]): void {
  if (attempt.code === 0) {
    throw new Error(
      `\`bonne-garde add ${item}\` succeeded in a project with no ${modules.join(" and ")}: it must be refused`,
    );
  }
  const fix = `${cliRunner()} add ${[...modules, item].join(" ")}`;
  if (!attempt.stderr.includes(fix)) {
    throw new Error(
      `\`bonne-garde add ${item}\` was refused without naming \`${fix}\`; it printed: ${attempt.stderr.trim() || "(nothing)"}`,
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

/** Both streams of a command that has to succeed. */
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

/**
 * A command that has to fail, run with some variables set, and everything it printed: the deploy script
 * logs its refusals on stdout. It inherits no `VITE_*` variable: a build reads those from its
 * environment too, so one in the shell, or in a `.env` Bun loads into golden, would satisfy the build
 * the case means to leave without it.
 */
async function refused(
  argv: string[],
  cwd: string,
  env: Record<string, string>,
): Promise<{ code: number; output: string }> {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter(([name]) => !name.startsWith("VITE_")),
  );
  const proc = Bun.spawn(argv, {
    cwd,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: { ...inherited, ...env },
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, output: `${stdout}${stderr}` };
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
  const bonneGarde = (...args: string[]) => [NODE, join(cli, "bin.js"), ...args];
  const registry = `local:${join(ROOT, "registry")}`;

  await phase(timings, "pack", async () => {
    await run([BUN, "run", "pack:cli"], ROOT);
    await cp(PACKED_CLI, cli, { recursive: true });
    // What `npx bonne-garde` does first: the packed package has dependencies of its own,
    // and this copy sits in a temp directory with no node_modules to find them in.
    await run([BUN, "install"], cli);
  });

  const { items, excluded } = await phase(timings, "list", async () => {
    const fromItems = selectItems(
      await capture(bonneGarde("list", "--items", "--source", registry), work),
      EXCLUDED,
    );
    const fromModules = selectModules(
      await capture(bonneGarde("list", "--source", registry), work),
      MODULES,
      EXCLUDED_MODULES,
    );
    return { items: fromItems.items, excluded: [...fromItems.excluded, ...fromModules.excluded] };
  });
  for (const { name, reason } of excluded) {
    console.log(`golden: leaving out ${name}: ${reason}`);
  }
  if (![...items, ...excluded.map(({ name }) => name)].includes(REFUSED_FEATURE)) {
    throw new Error(`the refusal check needs the feature item ${REFUSED_FEATURE} in the registry`);
  }

  for (const [index, configuration] of CONFIGURATIONS.entries()) {
    await configured(work, timings, {
      bonneGarde,
      registry,
      items,
      configuration,
      first: index === 0,
    });
  }
}

/** One configuration, from `bonne-garde create` to the modules' `checks`. */
async function configured(
  work: string,
  timings: Timing[],
  options: {
    bonneGarde: (...args: string[]) => string[];
    registry: string;
    items: readonly string[];
    configuration: Configuration;
    first: boolean;
  },
): Promise<void> {
  const { bonneGarde, registry, configuration, first } = options;
  const { name } = configuration;
  const modules = addedModules(configuration);
  const pm = runnerOf(packageManagerOf(configuration));
  const installed = configuration.items ? options.items : [];
  const patched = PATCHED[name] ?? {};
  const patchedItems = configuration.items ? (PATCHED_ITEMS[name] ?? {}) : {};
  const pending = PENDING[name] ?? [];
  const project = join(work, `golden-${name}`);
  const step = <T>(label: string, body: () => Promise<T>) =>
    phase(timings, `${name}: ${label}`, body);

  console.log(`\ngolden: configuration ${name}: ${configuration.modules.join(" ")}`);
  await step("create", () =>
    run(
      bonneGarde(
        "create",
        project,
        "--pm",
        packageManagerOf(configuration),
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
        await attempt(bonneGarde("add", REFUSED_ITEM, "--yes", "--no-install"), project),
        REFUSED_ITEM,
        REFUSED_MODULE,
      );
      if ((await Bun.file(join(project, "bg.json")).text()) !== manifest) {
        throw new Error(`the refused \`bonne-garde add ${REFUSED_ITEM}\` changed bg.json`);
      }
      expectRefusal(
        await attempt(bonneGarde("add", REFUSED_FEATURE, "--yes", "--no-install"), project),
        REFUSED_FEATURE,
        ...REFUSED_FEATURE_MODULES,
      );
      if ((await Bun.file(join(project, "bg.json")).text()) !== manifest) {
        throw new Error(`the refused \`bonne-garde add ${REFUSED_FEATURE}\` changed bg.json`);
      }
    });
  }
  if (first && hasAuth(configuration)) {
    await refusedPeer(work, timings, bonneGarde, registry);
  }
  if (first && hasAuth(configuration) && hasEmail(configuration)) {
    await reselected(work, timings, bonneGarde, registry);
  }
  if (first && hasFeatures(configuration)) {
    for (const refusal of FEATURE_REFUSALS) {
      await refusedFeature(work, timings, bonneGarde, registry, refusal);
    }
  }
  const added = await step("add", async () => {
    const stdout = await capture(bonneGarde(...addArguments(modules, installed)), project);
    process.stdout.write(stdout);
    const reported = [...readAddedModules(stdout, modules), ...readAddedItems(stdout)];
    expectPatches(reported, "applied", { ...patched, ...patchedItems });
    expectPending(readPendingIntentions(stdout), pending);
    const manifest: unknown = JSON.parse(await Bun.file(join(project, "bg.json")).text());
    expectRegionsRecorded(manifest, reported);
    // Pending is not recorded: no file carries an intention's region before `bonne-garde record` leaves it.
    for (const id of pending) {
      expectNoIntentRegion(manifest, id);
    }
    return reported;
  });
  // Before `bun install`, so that node_modules and the lockfile are not in the comparison.
  await step("re-add", async () => {
    const before = await snapshot(project);
    const stdout = await capture(bonneGarde(...addArguments(modules, installed)), project);
    expectPatches([...readAddedModules(stdout, modules), ...readAddedItems(stdout)], "skipped", {
      ...patched,
      ...patchedItems,
    });
    // Staged again, and the same bytes: the intention is still pending, and nothing moved.
    expectPending(readPendingIntentions(stdout), pending);
    const changed = diffTrees(before, await snapshot(project));
    if (changed.length > 0) {
      throw new Error(
        `the same \`bonne-garde add\` again changed the project: ${changed.join(", ")}`,
      );
    }
  });
  // Each module on its own, after the whole set was installed in one call: a file one module vendors
  // and another patched (db/d1's package.json, api/elysia's app.ts) is the project's by then, and the
  // owner asked for alone has to keep it, skip its patches and change nothing.
  await step("re-add alone", async () => {
    for (const module of modules) {
      const before = await snapshot(project);
      const stdout = await capture(bonneGarde(...addArguments([module], [])), project);
      const expected = Object.fromEntries(
        Object.entries(patched).filter(([name]) => name === module),
      );
      expectPatches(readAddedModules(stdout, [module]), "skipped", expected);
      const changed = diffTrees(before, await snapshot(project));
      if (changed.length > 0) {
        throw new Error(
          `\`bonne-garde add ${module}\` alone changed the project: ${changed.join(", ")}`,
        );
      }
    }
    // Each feature item on its own too: its dependencies are in a file its module owns, the item
    // finds them present and equal, and the project is as it was.
    for (const item of installed.filter((name) => Object.hasOwn(patchedItems, name))) {
      const before = await snapshot(project);
      const stdout = await capture(bonneGarde("add", item, "--yes", "--no-install"), project);
      expectPatches(readAddedItems(stdout), "skipped", { [item]: patchedItems[item] ?? [] });
      const changed = diffTrees(before, await snapshot(project));
      if (changed.length > 0) {
        throw new Error(
          `\`bonne-garde add ${item}\` alone changed the project: ${changed.join(", ")}`,
        );
      }
    }
  });
  // A module that accepts one provider is refused on the other, naming it, and writes nothing.
  if (refusesDeploy(configuration)) {
    await step("deploy: refuse", async () => {
      const before = await snapshot(project);
      expectProviderRefusal(
        await attempt(bonneGarde("add", DEPLOY_MODULE, "--yes", "--no-install"), project),
        DEPLOY_MODULE,
        DEPLOY_PROVIDER.split("/")[1] ?? "",
        modules.find((module) => module.startsWith("provider/"))?.split("/")[1] ?? "",
      );
      const changed = diffTrees(before, await snapshot(project));
      if (changed.length > 0) {
        throw new Error(
          `the refused \`bonne-garde add ${DEPLOY_MODULE}\` changed the project: ${changed.join(", ")}`,
        );
      }
    });
  }
  // What an executor does with each pending intention, once every install is known to be stable:
  // the edit its document describes, and the test its Validation names. Recording waits for that
  // Validation, which is the project's own typecheck, tests and check below.
  if (pending.length > 0) {
    await step("intentions: apply", async () => {
      for (const id of pending) {
        await resolution(id).apply(project);
      }
    });
  }
  await step("install", () => run(pm.install, project));
  await step("typecheck", () => run(pm.run("typecheck"), project));
  await step("test", async () => {
    const { stdout, stderr } = await captureBoth(pm.run("test"), project);
    const ran = testCounts(`${stdout}\n${stderr}`);
    if (hasAuth(configuration)) {
      expectRan(ran, `${SCOPE}/auth`, AUTH_MIN_TESTS);
    }
    if (hasEmail(configuration)) {
      expectRan(ran, `${SCOPE}/email`, EMAIL_MIN_TESTS);
    }
    if (hasStorage(configuration)) {
      expectRan(ran, `${SCOPE}/storage`, STORAGE_MIN_TESTS);
    }
    expectRan(ran, `${SCOPE}/spa`, spaMinTests(configuration));
    const counts = Object.entries(ran);
    console.log(
      `golden: tests run: ${counts.map(([workspace, ran]) => `${workspace} ${ran}`).join(", ")}`,
    );
  });
  await step("build", () => run(pm.run("build"), project));
  // The binary favicons are the registry's bytes, and the build the SPA made serves the manifest it
  // links and the icons that manifest names, from the files the project holds.
  if (hasFavicons(configuration)) {
    await step("favicons", async () => {
      await expectFaviconsIdentical(join(ROOT, "registry"), project);
      const icons = await expectManifestEmitted(
        join(project, "apps/spa/build/client"),
        join(project, FAVICONS_DIR),
      );
      console.log(`golden: the build serves the manifest's icons: ${icons.join(", ")}`);
      // Every shell holds the favicons the way the spa does, and keeps its own `public/`. A static site
      // has an index.html to read; an SSR app has none, so its built Worker answers.
      const favicons = join(project, FAVICONS_DIR);
      for (const shell of faviconShells(configuration)) {
        const app = join(project, "apps", shell);
        const client = join(app, "build/client");
        const held = await expectBuildHoldsFavicons(client, favicons);
        const kept = await expectOwnPublicKept(app);
        if (shell === "static") {
          await expectManifestEmitted(client, favicons);
        }
        if (shell === "ssr") {
          const served = await previewed(app, (origin) => expectFaviconsServed(origin, favicons));
          console.log(`golden: apps/ssr serves ${served.join(", ")}`);
        }
        console.log(
          `golden: apps/${shell} holds ${held.length} favicons and keeps ${kept.join(", ") || "no file of its own"}`,
        );
      }
    });
  }
  // Typecheck, test and build passed with the edit and its test in place, and the formatter has to
  // accept the edit too: that is the intention's Validation, so it is recorded now and not before.
  if (pending.length > 0) {
    await step("intentions: record", async () => {
      await run(pm.run("check"), project);
      for (const id of pending) {
        await run(bonneGarde("record", id), project);
        // The edited file is region-checked from here on: bg.json holds the intention's region on it.
        const { module, file } = resolution(id);
        expectIntentRegion(
          JSON.parse(await Bun.file(join(project, "bg.json")).text()),
          id,
          file,
          module,
        );
      }
    });
  }
  await step("doctor", () => run(bonneGarde("doctor", "--strict"), project));
  if (hasDeploy(configuration)) {
    await deployPlanned(project, timings, name, pm);
  }
  // The owner of the file the edit landed in, and the module that shipped the intention, asked for again:
  // the edit is the project's by now, so each has to keep it, skip its patches, stage nothing and change nothing.
  if (pending.length > 0) {
    await step("intentions: re-add", async () => {
      for (const id of pending) {
        const { module, editedOwner, file } = resolution(id);
        for (const owner of [module, editedOwner]) {
          const before = await snapshot(project);
          const stdout = await capture(bonneGarde(...addArguments([owner], [])), project);
          const expected = Object.fromEntries(
            Object.entries(patched).filter(([key]) => key === owner),
          );
          expectPatches(readAddedModules(stdout, [owner]), "skipped", expected);
          expectPending(readPendingIntentions(stdout), []);
          if (owner === editedOwner) {
            // The owner of the edited file wrote it and its recorded sha no longer matches: the region
            // is what makes the add keep it and say so, instead of refusing or overwriting it.
            expectKept(stdout, file);
          }
          const changed = diffTrees(before, await snapshot(project));
          if (changed.length > 0) {
            throw new Error(
              `\`bonne-garde add ${owner}\` after ${id} was recorded changed the project: ${changed.join(", ")}`,
            );
          }
        }
      }
    });
  }
  if (hasAuth(configuration)) {
    await regenerated(project, timings, name, pm);
  }
  if (hasDatabase(configuration)) {
    await migrated(project, timings, name, pm, expectedTables(configuration));
    if (hasAuth(configuration)) {
      await seeded(project, timings, name, pm, configuration);
    }
  }
  await step("check", () => run(pm.run("check"), project));
  if (hasPortless(configuration)) {
    await launched(project, timings, name, pm);
  }
  // A check names the project's own bins (`vp`, `tsc`), which bun or pnpm finds the way its `run` does.
  const bins = {
    PATH: `${join(project, "node_modules/.bin")}${delimiter}${process.env.PATH ?? ""}`,
  };
  for (const { module, checks } of added.filter(({ checks }) => checks.length > 0)) {
    await step(`checks:${module}`, async () => {
      for (const command of checks) {
        await run(["sh", "-c", command], project, bins);
      }
    });
  }
  if (buildsImage(configuration)) {
    await imaged(project, timings, name, hasSqliteFile(configuration));
  }
}

/**
 * The launcher of `dev/portless`, in the project it was installed into: its own tests counted (a root
 * script is outside the root `test` fan-out, so nothing else runs them), and its dry run, which needs
 * neither portless nor a proxy, compared with the apps this configuration installs: their names, addresses,
 * directories and commands, on `.localhost` and, with `--lan`, on `.local`.
 */
/**
 * Runs `vite preview` on a built app, which has the Cloudflare plugin run the built Worker with its assets in
 * workerd, as long as `body` takes. Its output is `preview.log` in the app, which stays with a failed run's project.
 */
async function previewed<T>(app: string, body: (origin: string) => Promise<T>): Promise<T> {
  const probe = Bun.serve({ port: 0, hostname: "127.0.0.1", fetch: () => new Response() });
  const port = probe.port;
  await probe.stop(true);
  const origin = `http://127.0.0.1:${port}`;
  const log = join(app, "preview.log");
  const server = Bun.spawn(
    ["bunx", "vp", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"],
    { cwd: app, stdin: "ignore", stdout: Bun.file(log), stderr: Bun.file(log), detached: true },
  );
  try {
    const ready = await until(
      async () => (await fetch(`${origin}/`, { signal: AbortSignal.timeout(2000) })).status === 200,
      { timeoutMs: 60_000, intervalMs: 500 },
    );
    if (!ready) {
      throw new Error(`\`vite preview\` did not answer GET / with 200 within 60 s, see ${log}`);
    }
    const result = await body(origin);
    await rm(log);
    return result;
  } finally {
    // The group: `bunx` starts node, which starts workerd. A preview that already exited has no group left.
    try {
      process.kill(-server.pid, "SIGTERM");
    } catch {
      // nothing to stop
    }
    await server.exited;
  }
}

async function launched(
  project: string,
  timings: Timing[],
  name: string,
  pm: Runner,
): Promise<void> {
  const slug = basename(project);
  const plan = (...flags: string[]) =>
    capture(pm.exec("tsx", "scripts/dev-portless.ts", "--dry-run", ...flags), project);

  await phase(timings, `${name}: portless tests`, async () => {
    const { stdout } = await captureBoth(
      pm.exec("vp", "test", "scripts/dev-portless.test.ts"),
      project,
    );
    expectRan({ [PORTLESS_MODULE]: ranTests(stdout) }, PORTLESS_MODULE, PORTLESS_MIN_TESTS);
  });
  await phase(timings, `${name}: portless plan`, async () => {
    expectPortlessPlan(await plan(), expectedPortlessApps(name, slug, "localhost"), "localhost");
    expectPortlessPlan(await plan("--lan"), expectedPortlessApps(name, slug, "local"), "local");
  });
}

/**
 * 035 and 050 acceptance: `bonne-garde add better-auth` in a project that has everything but an `orm` fails,
 * names the missing peer's category, and writes nothing. It needs a project of its own, because the
 * configuration under test has the ORM, and runs before the `add` of that one.
 */
async function refusedPeer(
  work: string,
  timings: Timing[],
  bonneGarde: (...args: string[]) => string[],
  registry: string,
): Promise<void> {
  const project = join(work, "golden-peer");
  await phase(timings, "peer: create", () =>
    run(
      bonneGarde(
        "create",
        project,
        "--pm",
        "bun",
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
  await phase(timings, "peer: add the modules but the orm", () =>
    run(bonneGarde("add", ...WITHOUT_ORM, "--yes", "--no-install"), project),
  );
  await phase(timings, "peer: refuse", async () => {
    const before = await snapshot(project);
    expectPeerRefusal(
      await attempt(bonneGarde("add", "better-auth", "--yes", "--no-install"), project),
      "better-auth",
      "orm",
    );
    const changed = diffTrees(before, await snapshot(project));
    if (changed.length > 0) {
      throw new Error(
        `the refused \`bonne-garde add better-auth\` changed the project: ${changed.join(", ")}`,
      );
    }
  });
}

/**
 * 035 and 050 step 7: `bonne-garde add auth/better-auth` in a project that has email on its default variant plans
 * email again on the `better-auth` one, in the same plan, and says so. The patch that declares the email
 * package in auth's package.json is applied, the wiring intention is staged and pending, and adding either
 * module again afterwards changes nothing and plans nothing again. It needs a project of its own: the
 * configuration under test installs auth first.
 */
async function reselected(
  work: string,
  timings: Timing[],
  bonneGarde: (...args: string[]) => string[],
  registry: string,
): Promise<void> {
  const project = join(work, "golden-reselect");
  const [wired] = PENDING.cloudflare ?? [];
  if (wired === undefined) {
    throw new Error("the other-order check needs the wiring intention in PENDING.cloudflare");
  }
  await phase(timings, "reselect: create and add email first", async () => {
    await run(
      bonneGarde(
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
    );
    const stdout = await capture(bonneGarde(...addArguments(RESELECT_BASE, [])), project);
    expectReselected(readReselected(stdout), []);
    expectPending(readPendingIntentions(stdout), []);
  });
  await phase(timings, "reselect: add auth", async () => {
    const stdout = await capture(bonneGarde("add", AUTH_MODULE, "--yes", "--no-install"), project);
    expectReselected(readReselected(stdout), [RESELECTED]);
    expectPending(readPendingIntentions(stdout), [wired]);
    const reported = readAddedModules(stdout, [AUTH_MODULE, EMAIL_MODULE]);
    const patched = PATCHED.cloudflare ?? {};
    expectPatches(reported, "applied", {
      [AUTH_MODULE]: patched[AUTH_MODULE] ?? [],
      [EMAIL_MODULE]: patched[EMAIL_MODULE] ?? [],
    });
    const manifest: unknown = JSON.parse(await Bun.file(join(project, "bg.json")).text());
    expectRegionsRecorded(manifest, reported);
    expectNoIntentRegion(manifest, wired);
    const email = isRecord(manifest) && isRecord(manifest.modules) ? manifest.modules.email : null;
    if (!Array.isArray(email) || !isRecord(email[0]) || email[0].variant !== RESELECTED.to) {
      throw new Error(`bg.json does not record email on variant ${RESELECTED.to}`);
    }
    const staged = await Bun.file(join(project, ".bg/add/session.md")).text();
    if (!staged.includes(wired)) {
      throw new Error(`.bg/add/session.md does not list ${wired}`);
    }
  });
  await phase(timings, "reselect: add either again", async () => {
    for (const name of [AUTH_MODULE, EMAIL_MODULE]) {
      const before = await snapshot(project);
      const stdout = await capture(bonneGarde("add", name, "--yes", "--no-install"), project);
      expectReselected(readReselected(stdout), []);
      const changed = diffTrees(before, await snapshot(project));
      if (changed.length > 0) {
        throw new Error(
          `\`bonne-garde add ${name}\` after the other order changed the project: ${changed.join(", ")}`,
        );
      }
    }
  });
}

/**
 * What deploying would do, proved with no account and no network: the workflow parses and only calls
 * scripts the project has, the script's dry run plans exactly the expected steps in order, every app
 * in it has a wrangler config and a deploy script and every app with a config is in it, a
 * `VITE_*` variable handed to the script is named in the plan and its value never printed, and the
 * plan names the variable each build needs, refusing variables that lack it.
 */
async function deployPlanned(
  project: string,
  timings: Timing[],
  name: string,
  pm: Runner,
): Promise<void> {
  await phase(timings, `${name}: deploy plan`, async () => {
    const expected = DEPLOY_PLAN[name];
    if (expected === undefined) {
      throw new Error(`no expected deploy plan for the ${name} configuration (DEPLOY_PLAN)`);
    }
    const root: unknown = JSON.parse(await Bun.file(join(project, "package.json")).text());
    const scripts = isRecord(root) && isRecord(root.scripts) ? Object.keys(root.scripts) : [];
    expectWorkflow(await Bun.file(join(project, DEPLOY_WORKFLOW)).text(), scripts, (action) =>
      existsSync(join(project, action, "action.yml")),
    );

    const needs = DEPLOY_BUILD_NEEDS[name];
    if (needs === undefined) {
      throw new Error(
        `no expected build variables for the ${name} configuration (DEPLOY_BUILD_NEEDS)`,
      );
    }
    const dryRun = pm.run(DEPLOY_SCRIPT, "--dry-run");
    const printed = await capture(dryRun, project);
    const plan = readDeployPlan(printed);
    expectDeployPlan(plan.steps, expected);
    expectBuildNeeds(readDeployNeeds(printed), needs);
    if (plan.buildVars.length > 0) {
      throw new Error(
        `the dry run forwards ${plan.buildVars.join(", ")} with no variable handed to it`,
      );
    }

    const optional = async (path: string): Promise<string | undefined> => {
      const file = Bun.file(join(project, path));
      return (await file.exists()) ? file.text() : undefined;
    };
    for (const app of plan.apps) {
      expectDeployableApp(
        app,
        await optional(`${app}/wrangler.jsonc`),
        await optional(`${app}/package.json`),
      );
    }
    const withWrangler: string[] = [];
    for (const dir of await readdir(join(project, "apps"))) {
      if ((await optional(`apps/${dir}/wrangler.jsonc`)) !== undefined) {
        withWrangler.push(`apps/${dir}`);
      }
    }
    expectEveryAppPlanned(plan.apps, withWrangler);

    // The workflow hands the environment's variables over as JSON: only the ones Vite exposes are
    // forwarded to a build, and the plan names them without their values.
    const secretish = "https://golden.invalid";
    const forwarded = await capture(dryRun, project, {
      VARS_JSON: JSON.stringify({ VITE_API_URL: secretish, API_URL: secretish }),
    });
    if (forwarded.includes(secretish)) {
      throw new Error("the dry run printed the value of a variable it was handed");
    }
    const { buildVars } = readDeployPlan(forwarded);
    if (buildVars.length !== 1 || buildVars[0] !== "VITE_API_URL") {
      throw new Error(
        `the dry run forwards ${JSON.stringify(buildVars)}, expected only VITE_API_URL`,
      );
    }

    if (Object.keys(needs).length === 0) {
      // No build needs a variable: a run handed none goes ahead.
      await capture(dryRun, project, { VARS_JSON: "{}" });
      return;
    }

    // A front built without its API URL deploys and is broken: handed variables that lack what a build
    // needs (none at all, an unrelated one, an empty one), the dry run refuses. The real run does the
    // same before its first build; golden does not start it, since a regression would reach Cloudflare.
    for (const VARS_JSON of [
      "{}",
      JSON.stringify({ API_URL: secretish }),
      JSON.stringify({ VITE_API_URL: "" }),
    ]) {
      expectBuildVarsRefusal(await refused(dryRun, project, { VARS_JSON }), needs, [secretish]);
    }
  });
}

/**
 * `bun run auth:generate` in the project, which runs the pinned Better Auth CLI on node and the
 * formatter, has to write the schema the module shipped: byte for byte, or the module carries an edit
 * the next regeneration would drop.
 */
async function regenerated(
  project: string,
  timings: Timing[],
  name: string,
  pm: Runner,
): Promise<void> {
  await phase(timings, `${name}: auth generate`, async () => {
    const file = join(project, AUTH_SCHEMA_FILE);
    const shipped = await Bun.file(file).text();
    await run(pm.run("auth:generate"), join(project, "packages/auth"));
    expectRegenerated(shipped, await Bun.file(file).text());
  });
}

/**
 * The database of a project with an `orm`: a table added to the schema barrel, `bun run db:generate`
 * writing its migration, `bun run db:migrate:local` applying it to the local D1 `wrangler` keeps under
 * `apps/api/.wrangler` (no network, no Cloudflare account, the placeholder `database_id` of the
 * module), and the database read back: the table is there and the migration is the one D1 recorded.
 * It runs after `doctor`, which would report the barrel as edited, and before `check`, which has to
 * pass over what `db:generate` wrote.
 */
async function migrated(
  project: string,
  timings: Timing[],
  name: string,
  pm: Runner,
  tables: readonly string[],
): Promise<void> {
  const db = join(project, "packages/db");
  const api = join(project, "apps/api");
  let migration = "";

  await phase(timings, `${name}: db generate`, async () => {
    await Bun.write(join(project, GOLDEN_SCHEMA_FILE), GOLDEN_SCHEMA);
    const barrel = join(project, GOLDEN_BARREL_FILE);
    await Bun.write(barrel, `${await Bun.file(barrel).text()}${GOLDEN_BARREL_LINE}`);
    await run(pm.run("db:generate"), db);
    const directory = join(db, "migrations");
    const files = await readdir(directory);
    const [first] = files.filter((file) => file.endsWith(".sql"));
    const sql = first === undefined ? "" : await Bun.file(join(directory, first)).text();
    for (const table of tables) {
      migration = expectGenerated(files, sql, table);
    }
  });

  await phase(timings, `${name}: db migrate`, async () => {
    await run(pm.run("db:migrate:local"), api, OFFLINE);
    const rows = async (statement: string, column: string): Promise<string[]> =>
      d1Rows(
        await capture(
          pm.exec("wrangler", "d1", "execute", "DB", "--local", "--json", "--command", statement),
          api,
          OFFLINE,
        ),
      ).flatMap((row) => (typeof row[column] === "string" ? [row[column]] : []));
    const database = {
      tables: await rows("SELECT name FROM sqlite_master WHERE type = 'table'", "name"),
      applied: await rows("SELECT name FROM d1_migrations ORDER BY id", "name"),
    };
    for (const table of tables) {
      expectMigrated(database, table, migration);
    }
    expectNothingToApply(await capture(pm.run("db:migrate:local"), api, OFFLINE));
  });
}

/**
 * `bun run db:seed` against the local D1 the migration phase filled, which has the auth tables because
 * the module re-exports them from the schema barrel; then a row in every other table the barrel exports,
 * a media with an author and no organization among them; then `bun run db:reset`, the orm's, which has
 * to leave every table empty; then `db:seed` again, which has to leave the admin once; then once more on
 * the seeded database, which has to say so and leave every table with the rows it had. The SQL is tested
 * against SQLite and Better Auth in the modules; this is the runners (`wrangler d1 execute` by the
 * binding `DB`) and D1 itself, which enforces the foreign keys the order of the deletes is for.
 */
async function seeded(
  project: string,
  timings: Timing[],
  name: string,
  pm: Runner,
  configuration: Configuration,
): Promise<void> {
  const api = join(project, "apps/api");
  const auth = join(project, "packages/auth");
  const db = join(project, "packages/db");
  const select = async (statement: string) =>
    d1Rows(
      await capture(
        pm.exec("wrangler", "d1", "execute", "DB", "--local", "--json", "--command", statement),
        api,
        OFFLINE,
      ),
    );
  const execute = (statement: string) =>
    run(
      pm.exec("wrangler", "d1", "execute", "DB", "--local", "--command", statement),
      api,
      OFFLINE,
    );
  const seedAdmin = async () => {
    await run(pm.run("db:seed"), auth, OFFLINE);
    expectSeeded(
      await select('SELECT email, email_verified FROM "user"'),
      await select('SELECT role FROM "member"'),
    );
  };

  await phase(timings, `${name}: auth db:seed`, seedAdmin);

  await phase(timings, `${name}: db reset`, async () => {
    const tables = resetTables(configuration);
    const storage = hasStorage(configuration);
    await execute(GOLDEN_NOTE_STATEMENT);
    if (storage) {
      await execute(GOLDEN_MEDIA_STATEMENT);
    }
    // The inserts above select from or add to what the seed left: one that matched nothing would make
    // the reset below prove less than it appears to.
    expectRows(readCounts(await select(countStatement(tables))), {
      user: 1,
      [GOLDEN_TABLE]: 1,
      ...(storage ? { medias: 1 } : {}),
    });

    await run(pm.run("db:reset"), db, OFFLINE);

    expectRows(
      readCounts(await select(countStatement(tables))),
      Object.fromEntries(tables.map((table) => [table, 0])),
    );
  });

  await phase(timings, `${name}: auth db:seed again`, seedAdmin);

  await phase(timings, `${name}: auth db:seed on a seeded database`, async () => {
    const tables = resetTables(configuration);
    const before = readCounts(await select(countStatement(tables)));
    expectAlreadySeeded(await capture(pm.run("db:seed"), auth, OFFLINE));
    expectRows(readCounts(await select(countStatement(tables))), before);
  });
}

/**
 * The image of a project that ships a Dockerfile: built, run on a host port docker picks, asked for
 * what a deployed container answers, then removed. Everything it creates is named `bg-golden-<pid>`
 * and removed by that name, the container first since it holds the image and the volume. Nothing
 * else on the machine is touched: no prune, no cache clear.
 */
async function imaged(
  project: string,
  timings: Timing[],
  name: string,
  sqlite: boolean,
): Promise<void> {
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
        await answers(project, docker, sqlite);
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
async function answers(project: string, docker: string, sqlite: boolean): Promise<void> {
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
  // The favicons are files of the build: the container serves the manifest the page links and each
  // icon it names, and not the index.html it answers a route with when it finds no file.
  const manifestUrl = manifestHref(home.body);
  const manifest = await get(manifestUrl);
  expectServed(`GET ${manifestUrl}`, manifest, 200, "application/manifest+json");
  for (const icon of manifestIconPaths(manifest.body, manifestUrl)) {
    expectServed(`GET ${icon}`, await get(icon), 200, "image/png");
  }
  // A client route has no file: the runtime answers a navigation with the SPA's index.html.
  const route = "/golden/unknown-client-route";
  const client = await get(route, "text/html");
  expectServed(`GET ${route} (Accept: text/html)`, client, 200, "text/html");
  if (client.body !== home.body) {
    throw new Error(`GET ${route} (Accept: text/html) answered something other than GET /`);
  }
  // The API opened its database on the first request: the volume holds the SQLite file.
  if (sqlite) {
    await run(["docker", "exec", docker, "test", "-f", SQLITE_FILE], project);
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

/**
 * A feature item in a project that has every module it needs but one: refused, the one named in a
 * command that fixes it, and nothing written. The packed CLI is what answers, as a consumer's agent reads it.
 */
async function refusedFeature(
  work: string,
  timings: Timing[],
  bonneGarde: (...args: string[]) => string[],
  registry: string,
  refusal: (typeof FEATURE_REFUSALS)[number],
): Promise<void> {
  const { label, modules, item, missing } = refusal;
  const project = join(work, `golden-feature-${label}`);
  await phase(timings, `feature: ${label}: create`, async () => {
    await run(
      bonneGarde(
        "create",
        project,
        "--pm",
        "bun",
        "--yes",
        "--no-git",
        "--no-install",
        "--scope",
        SCOPE,
        "--registry",
        registry,
      ),
      work,
    );
    await run(bonneGarde("add", ...modules, "--yes", "--no-install"), project);
  });
  await phase(timings, `feature: ${label}: refuse`, async () => {
    const before = await snapshot(project);
    expectRefusal(
      await attempt(bonneGarde("add", item, "--yes", "--no-install"), project),
      item,
      ...missing,
    );
    const changed = diffTrees(before, await snapshot(project));
    if (changed.length > 0) {
      throw new Error(
        `the refused \`bonne-garde add ${item}\` changed the project: ${changed.join(", ")}`,
      );
    }
  });
}
