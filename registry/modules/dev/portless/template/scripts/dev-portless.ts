#!/usr/bin/env bun
/**
 * Start every app of the project behind portless (named HTTPS URLs instead of ports):
 *   https://api.<slug>.localhost, https://spa.<slug>.localhost, one per `apps/<dir>`.
 * With --lan the proxy binds the network and serves the same names under .local (mDNS), so a phone
 * on the same Wi-Fi can reach them and gets a trusted HTTPS origin.
 *
 * The apps are the directories of `apps/` whose package.json has a `dev` script, so the launcher
 * fits any set of modules: it names none of them. Every app is a subdomain of the same registrable
 * domain, so all of them stay same-site and auth cookies keep flowing, and each learns the others'
 * URLs through environment variables named after their directories (`API_URL`, `VITE_API_URL`).
 *
 * How an app is started is read from its own `dev` script: `wrangler` gets the free port portless
 * assigns and the URLs as `--var`s, a script that starts with `bun` reads the PORT variable portless
 * sets, and any other command (`react-router dev`, `vite`) runs through `bunx`, which portless
 * recognises and injects `--port` into. A script that is not one plain command runs as `bun run dev`.
 *
 * portless is a root devDependency; starting or switching its proxy asks for sudo (it binds 443 and
 * trusts a local CA).
 *
 * Usage (from the project root):
 *   bun run dev:portless                 start the stack
 *   bun run dev:lan:portless             the same, reachable from the LAN
 *   bun scripts/dev-portless.ts --dry-run [--lan]   print the plan as JSON, start nothing
 */

import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

/** An app of the project: `apps/<dir>`, started by its `dev` script. */
export type App = {
  dir: string;
  dev: string;
  /** The app has a wrangler config: a Worker or a Pages project, whatever its `dev` script runs. */
  wrangler?: true;
};

export type PlannedApp = {
  dir: string;
  /** The portless name, `<dir>.<slug>`. */
  name: string;
  url: string;
  /** Where the process runs, relative to the project root. */
  cwd: string;
  cmd: string[];
  /** Added to the process environment. */
  env: Record<string, string>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readJson(path: string, label: string): unknown {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new Error(`${label} is not readable JSON`);
  }
}

const WRANGLER_CONFIGS = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** Every `apps/<dir>` with a `dev` script in its package.json, sorted by directory. */
export function discoverApps(root: string): App[] {
  const apps = join(root, "apps");
  if (!existsSync(apps)) {
    return [];
  }
  return readdirSync(apps, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort()
    .flatMap((dir) => {
      const file = join(apps, dir, "package.json");
      if (!existsSync(file)) {
        return [];
      }
      const pkg = readJson(file, `apps/${dir}/package.json`);
      const dev = isRecord(pkg) && isRecord(pkg.scripts) ? pkg.scripts.dev : undefined;
      if (typeof dev !== "string" || dev.trim() === "") {
        return [];
      }
      const wrangler = WRANGLER_CONFIGS.some((name) => existsSync(join(apps, dir, name)));
      return [wrangler ? { dir, dev, wrangler } : { dir, dev }];
    });
}

/** What a DNS label holds: lowercase letters, digits and interior hyphens. */
function hostLabel(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** The project's label in every hostname: the root package name, without its npm scope. */
export function portlessSlug(packageName: string | undefined): string {
  const name = packageName ?? "";
  const slug = hostLabel(name.slice(name.lastIndexOf("/") + 1));
  if (slug === "") {
    throw new Error("the root package.json has no package name a hostname can be made of");
  }
  return slug;
}

/**
 * Each app gets its own subdomain of one registrable domain, so the apps stay same-site and auth
 * cookies behave as in production.
 */
export function portlessName(slug: string, dir: string): string {
  return `${hostLabel(dir)}.${slug}`;
}

/** The URL of a name on a proxy with its defaults: `.local` in LAN mode, `.localhost` otherwise. */
export function defaultUrl(name: string, lan: boolean): string {
  return `https://${name}.${lan ? "local" : "localhost"}`;
}

/** LAN mode serves every name under `.local`; loopback mode never does. */
export function needsProxyRestart(currentUrl: string, lan: boolean): boolean {
  return new URL(currentUrl).hostname.endsWith(".local") !== lan;
}

/**
 * Names the shipped modules read that an app's directory does not give: `web/static` reads the SPA's
 * URL as `VITE_APP_URL`, and `storage/r2` serves its files under the API's `/v1/media/file`. An alias
 * is left out when the app it points at is not installed.
 */
const ALIASES: readonly { name: string; app: string; path: string }[] = [
  { name: "VITE_APP_URL", app: "spa", path: "" },
  { name: "R2_PUBLIC_URL", app: "api", path: "/v1/media/file" },
];

/**
 * What every app learns of the others, by the directory of the app whose URL it is: `<DIR>_URL` for a
 * server (`API_URL`, `SPA_URL`) and `VITE_<DIR>_URL` for a Vite front, which only exposes `VITE_*`.
 */
export function urlEnv(urls: Readonly<Record<string, string>>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [dir, url] of Object.entries(urls)) {
    const key = dir.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
    env[`${key}_URL`] = url;
    env[`VITE_${key}_URL`] = url;
  }
  for (const { name, app, path } of ALIASES) {
    const url = urls[app];
    if (url !== undefined) {
      env[name] = `${url}${path}`;
    }
  }
  return env;
}

type Dev =
  | { kind: "wrangler" | "bun" | "runner"; words: string[] }
  | { kind: "script"; words?: undefined };

/** One plain command: words of path and flag characters, no env prefix, quoting, operator or expansion. */
function readDev(dev: string): Dev {
  const words = dev.trim().split(/\s+/);
  const [first = ""] = words;
  if (first.includes("=") || !words.every((word) => /^[\w@./:=+,-]+$/.test(word))) {
    return { kind: "script" };
  }
  if (first === "wrangler") {
    return { kind: "wrangler", words };
  }
  return { kind: first === "bun" ? "bun" : "runner", words };
}

/** The words of a wrangler command without the port it fixes: portless assigns it. */
function withoutPort(words: readonly string[]): string[] {
  const kept: string[] = [];
  for (let at = 0; at < words.length; at++) {
    const word = words[at] ?? "";
    if (word === "--port") {
      at++;
    } else if (!word.startsWith("--port=")) {
      kept.push(word);
    }
  }
  return kept;
}

/**
 * The command that runs an app through portless. `vars` is what the app is told of the others: for
 * wrangler it goes in as `--var`, since a Worker reads its vars and not the process environment.
 */
export function launchCommand(
  app: App,
  name: string,
  vars: Readonly<Record<string, string>>,
): string[] {
  const head = ["portless", "run", "--name", name];
  const dev = readDev(app.dev);
  switch (dev.kind) {
    case "script":
      return [...head, "bun", "run", "dev"];
    case "bun":
      return [...head, ...dev.words];
    case "runner":
      // portless injects --port, --strictPort and --host into the commands it recognises
      // (`react-router`, `vite`) when they run through `bunx`.
      return [...head, "bunx", ...dev.words];
    case "wrangler": {
      const [, ...rest] = dev.words;
      const flags = Object.keys(vars)
        .sort()
        .filter((key) => !key.startsWith("VITE_"))
        .flatMap((key) => ["--var", `${key}:${vars[key]}`]);
      return [
        ...head,
        // PORT is only known once portless runs the child, hence the shell; "$@" forwards the --var flags.
        "sh",
        "-c",
        `exec bunx wrangler ${[...withoutPort(rest), "--port", '"$PORT"'].join(" ")} "$@"`,
        "wrangler",
        ...flags,
      ];
    }
  }
}

/**
 * What `wrangler` reads from the process environment only when it is asked to. A Worker that a Vite
 * command runs (the Cloudflare Vite plugin, `react-router dev`) takes its vars from its wrangler
 * config, so without this the URLs the launcher hands it are ignored and its own `localhost` ones win.
 * The whole environment of the process becomes visible to the Worker, which is local development only;
 * and wrangler skips it when the app has a `.dev.vars` file.
 */
const WRANGLER_INCLUDES_PROCESS_ENV = { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" };

/** What an app that is not started by `wrangler` itself is told through its process environment. */
function processEnv(app: App, vars: Readonly<Record<string, string>>): Record<string, string> {
  return app.wrangler ? { ...vars, ...WRANGLER_INCLUDES_PROCESS_ENV } : { ...vars };
}

/** The process of every app, in the order given, with the URL `urlOf` gives each name. */
export function planStack(options: {
  slug: string;
  apps: readonly App[];
  urlOf: (name: string) => string;
}): PlannedApp[] {
  const named = options.apps.map((app) => {
    const name = portlessName(options.slug, app.dir);
    return { app, name, url: options.urlOf(name) };
  });
  const vars = urlEnv(Object.fromEntries(named.map(({ app, url }) => [app.dir, url])));
  return named.map(({ app, name, url }) => ({
    dir: app.dir,
    name,
    url,
    cwd: `apps/${app.dir}`,
    cmd: launchCommand(app, name, vars),
    env: readDev(app.dev).kind === "wrangler" ? {} : processEnv(app, vars),
  }));
}

function portless(args: string[], env: Record<string, string | undefined> = process.env): string {
  const result = Bun.spawnSync(["portless", ...args], {
    env,
    stdin: "inherit",
    stderr: "inherit",
  });
  if (!result.success) {
    throw new Error(`portless ${args.join(" ")} failed (exit ${result.exitCode})`);
  }
  return result.stdout.toString().trim();
}

/**
 * The proxy is shared by every portless project and remembers its mode, and
 * `proxy start` is a no-op on a running proxy — so restart it only on a mode change.
 */
function ensureProxyMode(probeName: string, lan: boolean): void {
  if (needsProxyRestart(portless(["get", probeName]), lan)) {
    // Exits non-zero when no proxy is running; the start below covers that case.
    Bun.spawnSync(["portless", "proxy", "stop"], { stdio: ["inherit", "inherit", "inherit"] });
  }
  portless(["proxy", "start"], { ...process.env, PORTLESS_LAN: lan ? "1" : "0" });
}

function parseArgs(argv: readonly string[]): { lan: boolean; dryRun: boolean } {
  const unknown = argv.filter((arg) => arg !== "--lan" && arg !== "--dry-run");
  if (unknown.length > 0) {
    throw new Error(`unknown argument ${unknown.join(" ")}; it takes --lan and --dry-run`);
  }
  return { lan: argv.includes("--lan"), dryRun: argv.includes("--dry-run") };
}

async function main(argv: readonly string[], root: string): Promise<void> {
  const { lan, dryRun } = parseArgs(argv);
  const pkg = readJson(resolve(root, "package.json"), "the root package.json");
  const slug = portlessSlug(isRecord(pkg) && typeof pkg.name === "string" ? pkg.name : undefined);
  const apps = discoverApps(root);
  const [first] = apps;
  if (first === undefined) {
    throw new Error("no app to start: none of apps/*/package.json has a dev script");
  }

  if (dryRun) {
    const planned = planStack({ slug, apps, urlOf: (name) => defaultUrl(name, lan) });
    console.log(JSON.stringify({ slug, lan, apps: planned }, null, 2));
    return;
  }

  if (!Bun.which("portless")) {
    throw new Error("portless not found. Run `bun install` (it is a root devDependency).");
  }

  // Start the proxy up front so the apps don't race to start it.
  ensureProxyMode(portlessName(slug, first.dir), lan);
  const stack = planStack({ slug, apps, urlOf: (name) => portless(["get", name]) });

  const width = Math.max(...stack.map(({ dir }) => dir.length));
  console.log(
    `\nportless dev ready\n${stack.map(({ dir, url }) => `  ${dir.padEnd(width)}  ${url}`).join("\n")}\n`,
  );
  if (lan) {
    console.log(
      "  Phone (same Wi-Fi): trust the portless CA once — AirDrop ~/.portless/ca.pem, install the\n" +
        "  profile, then enable it in Settings › General › About › Certificate Trust Settings.\n",
    );
  }

  const running = stack.map((app) =>
    Bun.spawn(app.cmd, {
      cwd: resolve(root, app.cwd),
      env: { ...process.env, ...app.env },
      stdout: "inherit",
      stderr: "inherit",
      stdin: "inherit",
    }),
  );

  const stop = () => {
    for (const proc of running) proc.kill();
  };

  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  const codes = await Promise.all(running.map((proc) => proc.exited));
  const failed = codes.find((code) => code !== 0);
  if (failed !== undefined) {
    process.exit(failed);
  }
}

if (import.meta.main) {
  // `bun run` executes scripts from the package root, so the cwd is the project root.
  try {
    await main(Bun.argv.slice(2), process.cwd());
  } catch (error) {
    console.error(`dev-portless: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}
