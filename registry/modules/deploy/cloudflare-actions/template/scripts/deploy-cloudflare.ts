#!/usr/bin/env bun
/**
 * Deploys every Cloudflare app of this project to its `production` environment, in an order that
 * cannot leave a deploy half made by a build that fails.
 *
 * What it deploys is read from the tree on every run, not written into the workflow: an app is a
 * directory under `apps/` with a `wrangler.jsonc` and a `deploy` script in its `package.json`. The
 * modules that installed those apps own both, so a project that adds or drops a `web` module changes
 * what this deploys without anyone editing `.github/workflows/deploy.yml`.
 *
 *   1. `bun run build` in every app that has a build script, so a broken build stops the run before
 *      anything is deployed.
 *   2. For each app, the one that owns the database first and the others by directory: its
 *      `db:migrate:remote` script if it has one, then `bun run deploy`. A Worker is deployed with
 *      `--env production`; a Pages app with `--project-name <its wrangler name> --branch main`.
 *
 * Every step runs with `CLOUDFLARE_ENV=production`. A build also gets the `VITE_*` variables of the
 * workflow's GitHub environment (`VARS_JSON`, the JSON of the `vars` context): Vite bakes them into
 * the bundle, and an app such as the SPA throws at load without its API URL.
 *
 * Usage:
 *   bun run deploy:cloudflare --dry-run     # the plan as JSON: nothing runs, no credentials needed
 *   bun run deploy:cloudflare               # needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID
 */

import { access, readdir, readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

/** The wrangler environment every app of the project defines and this deploys to. */
const ENVIRONMENT = "production";

/** The branch a Pages deploy is made for: the project's production branch. */
const PRODUCTION_BRANCH = "main";

/** The script `db/d1` adds to the app that owns the database. */
const MIGRATE_SCRIPT = "db:migrate:remote";

/** What wrangler reads from the environment to talk to Cloudflare. */
const CREDENTIALS = ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID"];

/** Vite exposes to a bundle only the variables with this prefix, so they are the only ones a build is given. */
const BUILD_VAR_PREFIX = "VITE_";

export type Phase = "build" | "migrate" | "deploy";

/** One command of the plan, run in `cwd` (relative to the project root). */
export type Step = { phase: Phase; app: string; cwd: string; argv: string[] };

export type Env = Record<string, string | undefined>;

/** Runs a step with the given environment and resolves with its exit code. */
export type Runner = (step: Step, env: Env) => Promise<number>;

type App = {
  dir: string;
  kind: "worker" | "pages";
  /** The `name` of its wrangler config: a Pages project's name. */
  name: string;
  scripts: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** The directories under `apps/`, in code-unit order; none when the project has no `apps/`. */
async function appDirectories(root: string): Promise<string[]> {
  try {
    return (await readdir(join(root, "apps"))).sort();
  } catch (error) {
    if (isRecord(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/** The scripts of an app's `package.json`: none when it has no `package.json`. */
async function readScripts(root: string, path: string): Promise<Record<string, unknown>> {
  if (!(await exists(join(root, path)))) {
    return {};
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(await readFile(join(root, path), "utf8"));
  } catch {
    throw new Error(`${path} is not valid JSON`);
  }
  return isRecord(manifest) && isRecord(manifest.scripts) ? manifest.scripts : {};
}

/** The part of a wrangler config the plan needs, or an error naming the file and what it lacks. */
function readWrangler(path: string, text: string): Pick<App, "kind" | "name"> {
  let config: unknown;
  try {
    config = Bun.JSONC.parse(text);
  } catch {
    throw new Error(`${path} is not valid JSONC`);
  }
  if (!isRecord(config)) {
    throw new Error(`${path} is not a JSON object`);
  }
  if (typeof config.name !== "string" || config.name === "") {
    throw new Error(`${path} has no \`name\``);
  }
  const kind = typeof config.pages_build_output_dir === "string" ? "pages" : "worker";
  if (kind === "worker" && typeof config.main !== "string") {
    throw new Error(
      `${path} has neither \`main\` (a Worker) nor \`pages_build_output_dir\` (a Pages project)`,
    );
  }
  if (!isRecord(config.env) || !isRecord(config.env[ENVIRONMENT])) {
    throw new Error(
      `${path} has no \`env.${ENVIRONMENT}\`: the deploy targets that environment, and wrangler either fails without it or, in a config with no \`env\` at all, only warns and deploys the development values`,
    );
  }
  return { kind, name: config.name };
}

async function findApps(root: string): Promise<App[]> {
  const apps: App[] = [];
  for (const dir of await appDirectories(root)) {
    const wrangler = `apps/${dir}/wrangler.jsonc`;
    if (!(await exists(join(root, wrangler)))) {
      continue;
    }
    const scripts = await readScripts(root, `apps/${dir}/package.json`);
    if (typeof scripts.deploy !== "string") {
      continue;
    }
    apps.push({
      dir,
      scripts,
      ...readWrangler(wrangler, await readFile(join(root, wrangler), "utf8")),
    });
  }
  return apps;
}

/**
 * What a deploy runs, in order. Reads the tree and nothing else: it starts no process and reads no
 * environment, so the plan of a project is the same on a laptop and on the runner.
 */
export async function planDeploy(root: string): Promise<Step[]> {
  const apps = await findApps(root);
  if (apps.length === 0) {
    throw new Error(
      "nothing to deploy: an app is a directory under apps/ with a wrangler.jsonc and a `deploy` script in its package.json",
    );
  }
  // The app that owns the database goes first, so its schema is migrated before anything that calls it is deployed.
  const owns = (app: App): boolean => typeof app.scripts[MIGRATE_SCRIPT] === "string";
  const ordered = [...apps].sort(
    (a, b) => Number(owns(b)) - Number(owns(a)) || (a.dir < b.dir ? -1 : 1),
  );
  const step = (phase: Phase, app: App, argv: string[]): Step => ({
    phase,
    app: app.dir,
    cwd: `apps/${app.dir}`,
    argv: ["bun", "run", ...argv],
  });

  const builds = ordered
    .filter((app) => typeof app.scripts.build === "string")
    .map((app) => step("build", app, ["build"]));
  const releases = ordered.flatMap((app) => [
    ...(owns(app) ? [step("migrate", app, [MIGRATE_SCRIPT, "--env", ENVIRONMENT])] : []),
    step(
      "deploy",
      app,
      app.kind === "pages"
        ? ["deploy", "--project-name", app.name, "--branch", PRODUCTION_BRANCH]
        : ["deploy", "--env", ENVIRONMENT],
    ),
  ]);
  return [...builds, ...releases];
}

/**
 * The variables a build is given, from `VARS_JSON` (the `vars` context of the workflow, as JSON):
 * those Vite exposes to a bundle. An unset or empty value is no variables. A value that is not an
 * object of strings fails without echoing it, since the workflow's variables are not all public.
 */
export function buildVars(json: string | undefined): Record<string, string> {
  if (json === undefined || json.trim() === "") {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("VARS_JSON is not valid JSON");
  }
  if (!isRecord(parsed)) {
    throw new Error("VARS_JSON is not a JSON object of variables");
  }
  const vars: Record<string, string> = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (name.startsWith(BUILD_VAR_PREFIX) && typeof value === "string") {
      vars[name] = value;
    }
  }
  return vars;
}

/** Runs the plan through `run`, stopping at the first step that fails. Needs the Cloudflare credentials in `env`. */
export async function deploy(
  root: string,
  env: Env,
  run: Runner,
  log: (line: string) => void,
): Promise<void> {
  const steps = await planDeploy(root);
  const vars = buildVars(env.VARS_JSON);
  const missing = CREDENTIALS.filter((name) => !env[name]);
  if (missing.length > 0) {
    throw new Error(`${missing.join(" and ")} must be set to deploy (wrangler reads them)`);
  }
  // The workflow's variables went to `buildVars`; a child needs the credentials, not the whole JSON.
  const inherited = Object.fromEntries(
    Object.entries(env).filter(([name]) => name !== "VARS_JSON"),
  );

  for (const step of steps) {
    log(`==> ${step.phase} ${step.cwd}: ${step.argv.join(" ")}`);
    const code = await run(step, {
      ...inherited,
      ...(step.phase === "build" ? vars : {}),
      CLOUDFLARE_ENV: ENVIRONMENT,
    });
    if (code !== 0) {
      throw new Error(`${step.phase} ${step.cwd} failed: exit code ${code}`);
    }
  }
}

/** A runner that starts each step as a child process of the current one, in its directory under `root`. */
export function spawnRunner(root: string): Runner {
  return async (step, env) => {
    const child = Bun.spawn(step.argv, {
      cwd: join(root, step.cwd),
      env,
      stdio: ["inherit", "inherit", "inherit"],
    });
    return child.exited;
  };
}

export type Io = { root: string; env: Env; run: Runner; log: (line: string) => void };

/** The command: `--dry-run` prints the plan, no flag runs it. Resolves with the exit code and never throws. */
export async function main(args: readonly string[], io: Io): Promise<number> {
  try {
    const unknown = args.filter((arg) => arg !== "--dry-run");
    if (unknown.length > 0) {
      throw new Error(`unknown argument ${unknown.join(" ")}; the only flag is --dry-run`);
    }
    if (args.includes("--dry-run")) {
      const steps = await planDeploy(io.root);
      // Names only: the values of the workflow's variables are not this command's to print.
      const buildVarNames = Object.keys(buildVars(io.env.VARS_JSON));
      io.log(
        JSON.stringify({ environment: ENVIRONMENT, buildVars: buildVarNames, steps }, null, 2),
      );
      return 0;
    }
    await deploy(io.root, io.env, io.run, io.log);
    return 0;
  } catch (error) {
    io.log(`deploy: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }
}

if (import.meta.main) {
  const root = resolve(import.meta.dir, "..");
  process.exit(
    await main(process.argv.slice(2), {
      root,
      env: process.env,
      run: spawnRunner(root),
      log: (line) => process.stdout.write(`${line}\n`),
    }),
  );
}
