import { afterAll, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  defaultUrl,
  discoverApps,
  launchCommand,
  needsProxyRestart,
  planStack,
  portlessName,
  portlessSlug,
  urlEnv,
  type App,
} from "./dev-portless";

const SCRIPT = join(import.meta.dir, "dev-portless.ts");
const scratch: string[] = [];

afterAll(() => {
  for (const dir of scratch) rmSync(dir, { recursive: true, force: true });
});

/** A project root with the given `apps/<dir>/package.json` scripts, and a root package.json named `name`. */
function project(name: string, apps: Record<string, Record<string, string> | null>): string {
  const root = mkdtempSync(join(tmpdir(), "dev-portless-"));
  scratch.push(root);
  writeFileSync(join(root, "package.json"), JSON.stringify({ name }));
  for (const [dir, scripts] of Object.entries(apps)) {
    mkdirSync(join(root, "apps", dir), { recursive: true });
    if (scripts !== null) {
      writeFileSync(join(root, "apps", dir, "package.json"), JSON.stringify({ scripts }));
    }
  }
  return root;
}

const WORKER: App = { dir: "api", dev: "wrangler dev --port 5172" };
const BUN_SERVER: App = { dir: "api", dev: "bun --watch src/index.ts" };
const FRONT = (dir: string): App => ({ dir, dev: "react-router dev" });

describe("discoverApps", () => {
  it("lists every apps/<dir> whose package.json has a dev script, sorted by directory", () => {
    const root = project("acme", {
      spa: { dev: "react-router dev" },
      api: { dev: "wrangler dev --port 5172", test: "bun test" },
      docs: { build: "vite build" },
      bare: null,
    });
    writeFileSync(join(root, "apps", "notes.txt"), "not an app");

    expect(discoverApps(root)).toEqual([
      { dir: "api", dev: "wrangler dev --port 5172" },
      { dir: "spa", dev: "react-router dev" },
    ]);
  });

  it("notes which apps hold a wrangler config, whatever its format", () => {
    const root = project("acme", {
      api: { dev: "wrangler dev" },
      ssr: { dev: "react-router dev" },
      legacy: { dev: "react-router dev" },
      toml: { dev: "react-router dev" },
      spa: { dev: "react-router dev" },
    });
    writeFileSync(join(root, "apps", "ssr", "wrangler.jsonc"), "{}");
    writeFileSync(join(root, "apps", "legacy", "wrangler.json"), "{}");
    writeFileSync(join(root, "apps", "toml", "wrangler.toml"), "");
    writeFileSync(join(root, "apps", "api", "wrangler.jsonc"), "{}");

    expect(discoverApps(root).map(({ dir, wrangler }) => [dir, wrangler === true])).toEqual([
      ["api", true],
      ["legacy", true],
      ["spa", false],
      ["ssr", true],
      ["toml", true],
    ]);
  });

  it("finds nothing when the project has no apps directory", () => {
    expect(discoverApps(project("acme", {}))).toEqual([]);
  });

  it("names the file when a package.json is not JSON", () => {
    const root = project("acme", { api: { dev: "x" } });
    writeFileSync(join(root, "apps", "api", "package.json"), "{ nope");

    expect(() => discoverApps(root)).toThrow(/apps\/api\/package\.json/);
  });
});

describe("portlessSlug", () => {
  it("takes the package name as it is when it is already a hostname label", () => {
    expect(portlessSlug("acme")).toBe("acme");
  });

  it("drops the npm scope and lowers what a hostname cannot hold", () => {
    expect(portlessSlug("@acme/My_App")).toBe("my-app");
  });

  it("refuses a name that leaves no label", () => {
    expect(() => portlessSlug("@acme/")).toThrow(/package name/);
    expect(() => portlessSlug(undefined)).toThrow(/package name/);
  });
});

describe("portlessName and defaultUrl", () => {
  it("gives each app its own subdomain of the project, so the apps stay same-site", () => {
    expect(portlessName("acme", "api")).toBe("api.acme");
    expect(portlessName("acme", "static")).toBe("static.acme");
  });

  it("serves the names under .localhost, and under .local with --lan", () => {
    expect(defaultUrl("api.acme", false)).toBe("https://api.acme.localhost");
    expect(defaultUrl("api.acme", true)).toBe("https://api.acme.local");
  });
});

describe("needsProxyRestart", () => {
  it("restarts a loopback proxy when LAN is requested", () => {
    expect(needsProxyRestart("https://acme.localhost", true)).toBe(true);
  });

  it("restarts a LAN proxy when loopback is requested", () => {
    expect(needsProxyRestart("https://acme.local", false)).toBe(true);
  });

  it("keeps a proxy already in the requested mode", () => {
    expect(needsProxyRestart("https://acme.local", true)).toBe(false);
    expect(needsProxyRestart("https://acme.localhost", false)).toBe(false);
  });
});

describe("urlEnv", () => {
  const urls = {
    api: "https://api.acme.localhost",
    spa: "https://spa.acme.localhost",
    ssr: "https://ssr.acme.localhost",
    "static-site": "https://static-site.acme.localhost",
  };

  it("names each app's URL after its directory, plain and for Vite", () => {
    expect(urlEnv({ api: urls.api, "static-site": urls["static-site"] })).toMatchObject({
      API_URL: urls.api,
      VITE_API_URL: urls.api,
      STATIC_SITE_URL: urls["static-site"],
      VITE_STATIC_SITE_URL: urls["static-site"],
    });
  });

  it("adds the one name a shipped module reads that no directory gives", () => {
    expect(urlEnv(urls)).toMatchObject({ VITE_APP_URL: urls.spa });
  });

  it("names nothing else: a key a module reads from the runtime is that module's to default, not the launcher's to know", () => {
    expect(Object.keys(urlEnv(urls)).sort()).toEqual([
      "API_URL",
      "SPA_URL",
      "SSR_URL",
      "STATIC_SITE_URL",
      "VITE_API_URL",
      "VITE_APP_URL",
      "VITE_SPA_URL",
      "VITE_SSR_URL",
      "VITE_STATIC_SITE_URL",
    ]);
  });

  it("leaves an alias out when the app it points at is not installed", () => {
    const env = urlEnv({ ssr: urls.ssr });

    expect(Object.keys(env).sort()).toEqual(["SSR_URL", "VITE_SSR_URL"]);
  });
});

describe("launchCommand", () => {
  const VARS = { API_URL: "https://api.acme.localhost", SPA_URL: "https://spa.acme.localhost" };

  it("hands wrangler the free port portless assigns, in place of the script's own, and the URLs as vars", () => {
    expect(launchCommand(WORKER, "api.acme", VARS)).toEqual([
      "portless",
      "run",
      "--name",
      "api.acme",
      // PORT is only known once portless runs the child, hence the shell; "$@" forwards the --var flags.
      "sh",
      "-c",
      'exec bunx wrangler dev --port "$PORT" "$@"',
      "wrangler",
      "--var",
      "API_URL:https://api.acme.localhost",
      "--var",
      "SPA_URL:https://spa.acme.localhost",
    ]);
  });

  it("keeps the rest of a wrangler script, and drops a port written as --port=N too", () => {
    const app = { dir: "api", dev: "wrangler dev --port=5172 --env staging" };

    expect(launchCommand(app, "api.acme", {}).slice(4, 7)).toEqual([
      "sh",
      "-c",
      'exec bunx wrangler dev --env staging --port "$PORT" "$@"',
    ]);
  });

  it("passes no wrangler var that is only for Vite", () => {
    const command = launchCommand(WORKER, "api.acme", { API_URL: "a", VITE_API_URL: "a" });

    expect(command.filter((word) => word.includes("VITE_"))).toEqual([]);
  });

  it("runs a front through a runner portless recognises, so it injects a free port", () => {
    expect(launchCommand(FRONT("spa"), "spa.acme", VARS)).toEqual([
      "portless",
      "run",
      "--name",
      "spa.acme",
      "bunx",
      "react-router",
      "dev",
    ]);
  });

  it("runs a script that starts with bun as it is: the server reads the PORT portless sets", () => {
    expect(launchCommand(BUN_SERVER, "api.acme", VARS)).toEqual([
      "portless",
      "run",
      "--name",
      "api.acme",
      "bun",
      "--watch",
      "src/index.ts",
    ]);
  });

  it("falls back to the script itself for a command it cannot read as one word list", () => {
    for (const dev of ["vite && wrangler dev", "PORT=1 vite", "vite | cat", "vite --open $URL"]) {
      expect(launchCommand({ dir: "web", dev }, "web.acme", VARS)).toEqual([
        "portless",
        "run",
        "--name",
        "web.acme",
        "bun",
        "run",
        "dev",
      ]);
    }
  });
});

describe("planStack", () => {
  const url = (name: string) => `https://${name}.localhost`;

  describe("the four apps a cloudflare project has", () => {
    const stack = planStack({
      slug: "acme",
      // Every shipped front has a wrangler config: a Worker built with the Cloudflare Vite plugin
      // (ssr) or a Pages project (spa, static).
      apps: [
        { ...WORKER, wrangler: true },
        { ...FRONT("spa"), wrangler: true },
        { ...FRONT("ssr"), wrangler: true },
        { dir: "static", dev: "react-router dev", wrangler: true },
      ],
      urlOf: url,
    });
    const app = (dir: string) => stack.find((entry) => entry.dir === dir)!;

    it("starts one process per app, each in its own workspace directory", () => {
      expect(stack.map((entry) => [entry.dir, entry.cwd])).toEqual([
        ["api", "apps/api"],
        ["spa", "apps/spa"],
        ["ssr", "apps/ssr"],
        ["static", "apps/static"],
      ]);
    });

    it("names and addresses each app after its directory", () => {
      expect(stack.map((entry) => [entry.name, entry.url])).toEqual([
        ["api.acme", "https://api.acme.localhost"],
        ["spa.acme", "https://spa.acme.localhost"],
        ["ssr.acme", "https://ssr.acme.localhost"],
        ["static.acme", "https://static.acme.localhost"],
      ]);
    });

    it("gives wrangler the free port and every sibling's public URL", () => {
      expect(app("api").cmd).toEqual([
        "portless",
        "run",
        "--name",
        "api.acme",
        "sh",
        "-c",
        'exec bunx wrangler dev --port "$PORT" "$@"',
        "wrangler",
        "--var",
        "API_URL:https://api.acme.localhost",
        "--var",
        "SPA_URL:https://spa.acme.localhost",
        "--var",
        "SSR_URL:https://ssr.acme.localhost",
        "--var",
        "STATIC_URL:https://static.acme.localhost",
      ]);
      expect(app("api").env).toEqual({});
    });

    it("points every front at the proxied API, as the apps that were hard-wired did", () => {
      for (const dir of ["spa", "ssr", "static"]) {
        expect(app(dir).env).toMatchObject({
          API_URL: "https://api.acme.localhost",
          VITE_API_URL: "https://api.acme.localhost",
        });
      }
      expect(app("static").env.VITE_APP_URL).toBe("https://spa.acme.localhost");
    });

    // A Worker the Cloudflare Vite plugin runs reads the vars of its wrangler config, not the process
    // environment, unless wrangler is told to include it (verified under `react-router dev`: without
    // the flag the Worker keeps the config's `localhost` API_URL).
    it("lets the Worker a Vite command runs read the URLs it is given, by asking wrangler to include the process environment", () => {
      for (const dir of ["spa", "ssr", "static"]) {
        expect(app(dir).env.CLOUDFLARE_INCLUDE_PROCESS_ENV).toBe("true");
      }
    });

    it("tells a wrangler process nothing but through its --var flags: it has no use for the flag", () => {
      expect(app("api").env).toEqual({});
    });
  });

  describe("the two apps a dockerfile project has", () => {
    const stack = planStack({ slug: "acme", apps: [BUN_SERVER, FRONT("spa")], urlOf: url });

    it("runs the API as a Bun process that reads PORT, and the front as in any project", () => {
      expect(stack.map((entry) => entry.cmd)).toEqual([
        ["portless", "run", "--name", "api.acme", "bun", "--watch", "src/index.ts"],
        ["portless", "run", "--name", "spa.acme", "bunx", "react-router", "dev"],
      ]);
    });

    it("hands the API the front's URL as process env, which its runtime reads", () => {
      expect(stack[0]?.env).toMatchObject({
        API_URL: "https://api.acme.localhost",
        SPA_URL: "https://spa.acme.localhost",
      });
      expect(stack[1]?.env.VITE_API_URL).toBe("https://api.acme.localhost");
    });

    it("names no Cloudflare variable where no app has a wrangler config", () => {
      for (const { env } of stack) {
        expect(Object.keys(env).filter((name) => name.startsWith("CLOUDFLARE_"))).toEqual([]);
      }
    });
  });

  it("plans a project with one app, whatever it is called", () => {
    const stack = planStack({ slug: "acme", apps: [FRONT("admin")], urlOf: url });

    expect(stack.map((entry) => entry.name)).toEqual(["admin.acme"]);
    expect(stack[0]?.env).toEqual({
      ADMIN_URL: "https://admin.acme.localhost",
      VITE_ADMIN_URL: "https://admin.acme.localhost",
    });
  });

  it("asks for each URL once, by the app's name", () => {
    const asked: string[] = [];
    planStack({
      slug: "acme",
      apps: [WORKER, FRONT("spa")],
      urlOf: (name) => {
        asked.push(name);
        return url(name);
      },
    });

    expect(asked).toEqual(["api.acme", "spa.acme"]);
  });
});

/** Runs the launcher in `root` with no portless on the PATH: a plan has to need neither it nor a proxy. */
async function launch(root: string, ...args: string[]) {
  const proc = Bun.spawn([process.execPath, SCRIPT, ...args], {
    cwd: root,
    env: { ...process.env, PATH: dirname(process.execPath) },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, stdout, stderr };
}

describe("bun scripts/dev-portless.ts --dry-run", () => {
  const apps = {
    api: { dev: "bun --watch src/index.ts" },
    spa: { dev: "react-router dev" },
  };

  it("prints the plan as JSON and starts nothing", async () => {
    const { code, stdout } = await launch(project("acme", apps), "--dry-run");

    expect(code).toBe(0);
    const plan: unknown = JSON.parse(stdout);
    expect(plan).toMatchObject({
      slug: "acme",
      lan: false,
      apps: [
        {
          dir: "api",
          name: "api.acme",
          url: "https://api.acme.localhost",
          cwd: "apps/api",
          cmd: ["portless", "run", "--name", "api.acme", "bun", "--watch", "src/index.ts"],
        },
        {
          dir: "spa",
          name: "spa.acme",
          url: "https://spa.acme.localhost",
          cwd: "apps/spa",
          cmd: ["portless", "run", "--name", "spa.acme", "bunx", "react-router", "dev"],
        },
      ],
    });
  });

  it("plans the .local names with --lan", async () => {
    const { code, stdout } = await launch(project("acme", apps), "--dry-run", "--lan");

    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({
      lan: true,
      apps: [{ url: "https://api.acme.local" }, { url: "https://spa.acme.local" }],
    });
  });

  it("fails, naming where it looked, when no app has a dev script", async () => {
    const { code, stderr } = await launch(project("acme", { docs: { build: "x" } }), "--dry-run");

    expect(code).not.toBe(0);
    expect(stderr).toContain("apps/*/package.json");
  });

  it("refuses an argument it does not know", async () => {
    const { code, stderr } = await launch(project("acme", apps), "--dry-run", "--tls");

    expect(code).not.toBe(0);
    expect(stderr).toContain("--tls");
  });
});

describe("bun scripts/dev-portless.ts, without portless", () => {
  it("says to run bun install when the binary is not there", async () => {
    const { code, stderr } = await launch(project("acme", { spa: { dev: "react-router dev" } }));

    expect(code).not.toBe(0);
    expect(stderr).toContain("bun install");
  });
});
