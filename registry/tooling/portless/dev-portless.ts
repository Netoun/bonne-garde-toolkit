#!/usr/bin/env bun
/**
 * Start the whole stack behind portless (named HTTPS URLs instead of ports):
 *   static https://<slug>.localhost · spa https://spa.<slug>.localhost
 *   ssr    https://ssr.<slug>.localhost · API https://api.<slug>.localhost
 * With --lan the proxy binds the network and serves the same names under .local
 * (mDNS), so a phone on the same Wi-Fi can reach them and gets a trusted HTTPS
 * origin.
 *
 * Every app is a subdomain of the same registrable domain, so all four stay
 * same-site and auth cookies keep flowing. Every app gets a free port from
 * portless: the fronts through the `--port` it injects, the API through the PORT
 * variable it sets, which wrangler ignores unless given as `--port`.
 *
 * portless is a root devDependency; starting or switching its proxy asks for
 * sudo (it binds 443 and trusts a local CA).
 *
 * Usage (from the repo root):
 *   bun run dev:portless
 *   bun run dev:lan:portless
 */

import { resolve } from "node:path";

// `bun run` executes scripts from the package root, so the cwd is the repo root.
const ROOT = process.cwd();

export type AppKey = "api" | "spa" | "ssr" | "static";
export type PortlessNames = Record<AppKey, string>;
export type PortlessUrls = Record<AppKey, string>;

export type PortlessApp = {
  key: AppKey;
  cwd: string;
  cmd: string[];
  env: Record<string, string>;
};

/**
 * Each app gets its own subdomain of one registrable domain, so the apps stay
 * same-site and auth cookies behave as in production. static takes the apex.
 */
export function portlessNames(slug: string): PortlessNames {
  return {
    static: slug,
    spa: `spa.${slug}`,
    ssr: `ssr.${slug}`,
    api: `api.${slug}`,
  };
}

/** LAN mode serves every name under `.local`; loopback mode never does. */
export function needsProxyRestart(currentUrl: string, lan: boolean): boolean {
  return new URL(currentUrl).hostname.endsWith(".local") !== lan;
}

export function buildPortlessStack(names: PortlessNames, urls: PortlessUrls): PortlessApp[] {
  return [
    {
      key: "api",
      cwd: "apps/api",
      cmd: [
        "portless",
        "run",
        "--name",
        names.api,
        // PORT is only known once portless runs the child, hence the shell; "$@" forwards the --var flags.
        "sh",
        "-c",
        'exec bunx wrangler dev --port "$PORT" "$@"',
        "wrangler",
        "--var",
        `API_URL:${urls.api}`,
        "--var",
        `R2_PUBLIC_URL:${urls.api}/v1/media/file`,
        "--var",
        `SPA_URL:${urls.spa}`,
        "--var",
        `SSR_URL:${urls.ssr}`,
      ],
      env: {},
    },
    // Fronts run through `bunx react-router`: portless only injects
    // --port/--strictPort/--host for commands it recognises, not for `bun run dev`.
    {
      key: "spa",
      cwd: "apps/spa",
      cmd: ["portless", "run", "--name", names.spa, "bunx", "react-router", "dev"],
      env: { VITE_API_URL: urls.api },
    },
    {
      key: "ssr",
      cwd: "apps/ssr",
      cmd: ["portless", "run", "--name", names.ssr, "bunx", "react-router", "dev"],
      env: { API_URL: urls.api },
    },
    {
      key: "static",
      cwd: "apps/static",
      cmd: ["portless", "run", "--name", names.static, "bunx", "react-router", "dev"],
      env: { VITE_APP_URL: urls.spa, VITE_API_URL: urls.api },
    },
  ];
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

async function readSlug(): Promise<string> {
  const pkg = (await Bun.file(resolve(ROOT, "package.json")).json()) as { name?: string };
  if (!pkg.name) throw new Error("root package.json has no name");
  return pkg.name;
}

async function main(): Promise<void> {
  if (!Bun.which("portless")) {
    throw new Error("portless not found. Run `bun install` (it is a root devDependency).");
  }

  const lan = Bun.argv.slice(2).includes("--lan");
  const names = portlessNames(await readSlug());

  // Start the proxy up front so the apps don't race to start it.
  ensureProxyMode(names.static, lan);

  const urls: PortlessUrls = {
    api: portless(["get", names.api]),
    spa: portless(["get", names.spa]),
    ssr: portless(["get", names.ssr]),
    static: portless(["get", names.static]),
  };

  console.log(
    `\nportless dev ready\n  static    ${urls.static}\n  spa       ${urls.spa}\n` +
      `  ssr       ${urls.ssr}\n  API       ${urls.api}\n`,
  );
  if (lan) {
    console.log(
      "  Phone (same Wi-Fi): trust the portless CA once — AirDrop ~/.portless/ca.pem, install the\n" +
        "  profile, then enable it in Settings › General › About › Certificate Trust Settings.\n",
    );
  }

  const running = buildPortlessStack(names, urls).map((app) =>
    Bun.spawn(app.cmd, {
      cwd: resolve(ROOT, app.cwd),
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
  await main();
}
