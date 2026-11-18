import { afterEach, beforeEach, describe, expect, test } from "vite-plus/test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import {
  buildNeeds,
  buildVars,
  deploy,
  main,
  planDeploy,
  type Runner,
  type Step,
} from "./deploy-cloudflare";

type App = {
  /** The directory under `apps/`. */
  dir: string;
  /** The `wrangler.jsonc`, or none for an app that is not a Cloudflare one. */
  wrangler?: string;
  scripts?: Record<string, string>;
  /** The body of `src/vite-env.d.ts`, where an app may type what its build reads. */
  viteEnv?: string;
};

const worker = (name: string): string => `{
  // A Worker: its entry is source, wrangler bundles it.
  "name": "${name}",
  "main": "src/index.ts",
  "compatibility_date": "2025-06-01",
  "env": {
    "production": { "name": "${name}", "vars": { "API_URL": "https://api.example.com", }, },
  },
}
`;

const pages = (name: string): string => `{
  "name": "${name}",
  "pages_build_output_dir": "build/client",
  "env": { "production": { "vars": {} } },
}
`;

const SCRIPTS = { build: "react-router build", deploy: "wrangler deploy" };

let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "deploy-cloudflare-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function write(path: string, body: string): Promise<void> {
  await mkdir(dirname(join(root, path)), { recursive: true });
  await writeFile(join(root, path), body);
}

async function project(apps: readonly App[]): Promise<void> {
  for (const { dir, wrangler, scripts, viteEnv } of apps) {
    await write(`apps/${dir}/package.json`, JSON.stringify({ name: dir, scripts }));
    if (viteEnv !== undefined) {
      await write(`apps/${dir}/src/vite-env.d.ts`, viteEnv);
    }
    if (wrangler !== undefined) {
      await write(`apps/${dir}/wrangler.jsonc`, wrangler);
    }
  }
}

/** What a project with the cloudflare modules installed holds: an API with a database, three fronts. */
const FULL: readonly App[] = [
  {
    dir: "static",
    wrangler: pages("my-app-static"),
    scripts: { build: "react-router build", deploy: "wrangler pages deploy build/client" },
  },
  {
    dir: "api",
    wrangler: worker("my-app-api"),
    scripts: {
      build: "tsc --noEmit",
      deploy: "wrangler deploy",
      "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
    },
  },
  { dir: "ssr", wrangler: worker("my-app-ssr"), scripts: SCRIPTS },
  {
    dir: "spa",
    wrangler: pages("my-app-spa"),
    scripts: { build: "react-router build", deploy: "wrangler pages deploy build/client" },
  },
];

const summary = (steps: readonly Step[]): string[] =>
  steps.map(({ phase, cwd, argv }) => `${phase} ${cwd}: ${argv.join(" ")}`);

describe("planDeploy", () => {
  test("builds every app, then migrates and deploys the one with the database first, then the others by directory", async () => {
    await project(FULL);

    expect(summary(await planDeploy(root))).toEqual([
      "build apps/api: vp run build",
      "build apps/spa: vp run build",
      "build apps/ssr: vp run build",
      "build apps/static: vp run build",
      "migrate apps/api: vp run db:migrate:remote --env production",
      "deploy apps/api: vp run deploy --env production",
      "deploy apps/spa: vp run deploy --project-name my-app-spa --branch main",
      "deploy apps/ssr: vp run deploy --env production",
      "deploy apps/static: vp run deploy --project-name my-app-static --branch main",
    ]);
  });

  test("no build step fails after a deploy has started: every build comes before the first migration or deploy", async () => {
    await project(FULL);

    const phases = (await planDeploy(root)).map(({ phase }) => phase);

    expect(phases.lastIndexOf("build")).toBeLessThan(phases.indexOf("migrate"));
    expect(phases.lastIndexOf("build")).toBeLessThan(phases.indexOf("deploy"));
  });

  test("the app that owns the migration goes first whatever its name, and its migration is the step before its deploy", async () => {
    await project([
      { dir: "alpha", wrangler: pages("alpha"), scripts: SCRIPTS },
      {
        dir: "zeta",
        wrangler: worker("zeta"),
        scripts: { deploy: "wrangler deploy", "db:migrate:remote": "wrangler d1 migrations apply" },
      },
    ]);

    expect(summary(await planDeploy(root))).toEqual([
      "build apps/alpha: vp run build",
      "migrate apps/zeta: vp run db:migrate:remote --env production",
      "deploy apps/zeta: vp run deploy --env production",
      "deploy apps/alpha: vp run deploy --project-name alpha --branch main",
    ]);
  });

  test("a project without a database has no migration step, and an app without a build script no build step", async () => {
    await project([
      { dir: "api", wrangler: worker("my-app-api"), scripts: { deploy: "wrangler deploy" } },
    ]);

    expect(summary(await planDeploy(root))).toEqual([
      "deploy apps/api: vp run deploy --env production",
    ]);
  });

  test("the Pages project name is the one in the app's wrangler config, not one the plan invents", async () => {
    await project([{ dir: "spa", wrangler: pages("acme-landing"), scripts: SCRIPTS }]);

    const steps = await planDeploy(root);

    expect(steps.at(-1)?.argv).toEqual([
      "vp",
      "run",
      "deploy",
      "--project-name",
      "acme-landing",
      "--branch",
      "main",
    ]);
  });

  test("a directory that is not a Cloudflare app is left alone: no wrangler config, or no deploy script", async () => {
    await project([
      { dir: "api", wrangler: worker("my-app-api"), scripts: { deploy: "wrangler deploy" } },
      { dir: "docs", scripts: { build: "vite build", deploy: "netlify deploy" } },
      { dir: "worker-without-script", wrangler: worker("w"), scripts: { build: "tsc" } },
    ]);
    await write("apps/notes.txt", "a file, not an app");

    expect(summary(await planDeploy(root))).toEqual([
      "deploy apps/api: vp run deploy --env production",
    ]);
  });

  test("a project with nothing to deploy is an error that says what makes an app deployable", async () => {
    await project([{ dir: "docs", scripts: { build: "vite build" } }]);

    await expect(planDeploy(root)).rejects.toThrow(/wrangler\.jsonc.*deploy/s);
  });

  test("a project with no apps directory is the same error, not a crash", async () => {
    await expect(planDeploy(root)).rejects.toThrow(/nothing to deploy/);
  });

  describe("a wrangler config the plan cannot deploy from names its app and what is wrong", () => {
    const cases: readonly [string, string, RegExp][] = [
      ["is not JSONC", "{ this is not json", /apps\/api\/wrangler\.jsonc/],
      ["has no name", `{ "main": "src/index.ts", "env": { "production": {} } }`, /no `name`/],
      [
        "has neither a main nor a Pages output directory",
        `{ "name": "x", "env": { "production": {} } }`,
        /`main` .* `pages_build_output_dir`/,
      ],
      [
        "has no production environment",
        `{ "name": "x", "main": "src/index.ts" }`,
        /`env\.production`/,
      ],
    ];

    for (const [what, wrangler, message] of cases) {
      test(`a config that ${what}`, async () => {
        await project([{ dir: "api", wrangler, scripts: { deploy: "wrangler deploy" } }]);

        await expect(planDeploy(root)).rejects.toThrow(message);
        await expect(planDeploy(root)).rejects.toThrow(/apps\/api/);
      });
    }
  });

  test("a package.json that is not JSON names the app", async () => {
    await write("apps/api/package.json", "{ nope");
    await write("apps/api/wrangler.jsonc", worker("my-app-api"));

    await expect(planDeploy(root)).rejects.toThrow(/apps\/api\/package\.json/);
  });
});

describe("buildVars", () => {
  test("keeps the variables Vite exposes to a build, and drops every other one", () => {
    const json = JSON.stringify({
      VITE_API_URL: "https://api.example.com",
      VITE_ANALYTICS_ID: "ga-1",
      API_URL: "https://api.example.com",
      BETTER_AUTH_SECRET: "oops",
    });

    expect(buildVars(json)).toEqual({
      VITE_API_URL: "https://api.example.com",
      VITE_ANALYTICS_ID: "ga-1",
    });
  });

  test("no variables is an empty set: the workflow passes `{}` when the environment has none, and a local run passes nothing", () => {
    expect(buildVars("{}")).toEqual({});
    expect(buildVars(undefined)).toEqual({});
    expect(buildVars("")).toEqual({});
  });

  test("a value that is not a string is not forwarded", () => {
    expect(buildVars(JSON.stringify({ VITE_A: 1, VITE_B: null, VITE_C: "c" }))).toEqual({
      VITE_C: "c",
    });
  });

  test("JSON that is not an object of variables fails without printing what it held", () => {
    for (const json of ["{ nope", "[]", '"VITE_SECRET=hunter2"', "null"]) {
      expect(() => buildVars(json)).toThrow(/VARS_JSON/);
      expect(() => buildVars(json)).not.toThrow(/hunter2/);
    }
  });
});

describe("deploy", () => {
  const CREDENTIALS = { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" };

  /** A runner that records what it was asked and ends every step with `code`. */
  function recorder(code: (step: Step) => number = () => 0) {
    const calls: { step: Step; env: Record<string, string | undefined> }[] = [];
    const run: Runner = async (step, env) => {
      calls.push({ step, env });
      return code(step);
    };
    return { calls, run };
  }

  test("runs the plan in order, each step in its own directory", async () => {
    await project(FULL);
    const { calls, run } = recorder();

    await deploy(root, CREDENTIALS, run, () => {});

    expect(summary(calls.map(({ step }) => step))).toEqual(summary(await planDeploy(root)));
  });

  test("every step targets the production environment, and only a build sees the build variables", async () => {
    await project(FULL);
    const { calls, run } = recorder();

    await deploy(
      root,
      {
        ...CREDENTIALS,
        VARS_JSON: JSON.stringify({ VITE_API_URL: "https://api.example.com", OTHER: "x" }),
      },
      run,
      () => {},
    );

    for (const { step, env } of calls) {
      expect(env.CLOUDFLARE_ENV).toBe("production");
      expect(env.VITE_API_URL).toBe(step.phase === "build" ? "https://api.example.com" : undefined);
      // What the workflow handed over is not passed on: a child needs the credentials, not the JSON.
      expect(env.VARS_JSON).toBeUndefined();
      expect(env.OTHER).toBeUndefined();
      expect(env.CLOUDFLARE_API_TOKEN).toBe("token");
    }
  });

  test("stops at the first step that fails, names it, and runs nothing after it", async () => {
    await project(FULL);
    const { calls, run } = recorder(({ phase, app }) =>
      phase === "migrate" && app === "api" ? 3 : 0,
    );

    await expect(deploy(root, CREDENTIALS, run, () => {})).rejects.toThrow(
      /migrate apps\/api.*exit(ed)? (code )?3/s,
    );

    expect(calls.map(({ step }) => step.phase)).toEqual([
      "build",
      "build",
      "build",
      "build",
      "migrate",
    ]);
  });

  test("a failed build means nothing is deployed", async () => {
    await project(FULL);
    const { calls, run } = recorder(({ phase, app }) =>
      phase === "build" && app === "static" ? 1 : 0,
    );

    await expect(deploy(root, CREDENTIALS, run, () => {})).rejects.toThrow(/build apps\/static/);

    expect(calls.some(({ step }) => step.phase !== "build")).toBe(false);
  });

  test("without the Cloudflare credentials it fails before running anything, naming both", async () => {
    await project(FULL);
    const { calls, run } = recorder();

    await expect(deploy(root, {}, run, () => {})).rejects.toThrow(
      /CLOUDFLARE_API_TOKEN.*CLOUDFLARE_ACCOUNT_ID/s,
    );
    await expect(deploy(root, { CLOUDFLARE_API_TOKEN: "t" }, run, () => {})).rejects.toThrow(
      /CLOUDFLARE_ACCOUNT_ID/,
    );

    expect(calls).toEqual([]);
  });

  test("logs each step it runs, with its directory and command and never an environment value", async () => {
    await project([
      { dir: "api", wrangler: worker("my-app-api"), scripts: { deploy: "wrangler deploy" } },
    ]);
    const lines: string[] = [];

    await deploy(root, CREDENTIALS, recorder().run, (line) => lines.push(line));

    expect(lines.join("\n")).toContain("apps/api: vp run deploy --env production");
    expect(lines.join("\n")).not.toContain("token");
    expect(lines.join("\n")).not.toContain("account");
  });
});

describe("main", () => {
  async function run(args: string[], env: Record<string, string | undefined> = {}) {
    const lines: string[] = [];
    const calls: Step[] = [];
    const code = await main(args, {
      root,
      env,
      run: async (step) => {
        calls.push(step);
        return 0;
      },
      log: (line) => lines.push(line),
    });
    return { code, lines, calls };
  }

  test("--dry-run prints the plan as JSON, runs nothing, and needs no credentials", async () => {
    await project(FULL);

    const { code, lines, calls } = await run(["--dry-run"]);

    expect(code).toBe(0);
    expect(calls).toEqual([]);
    const plan: unknown = JSON.parse(lines.join("\n"));
    expect(plan).toMatchObject({
      environment: "production",
      buildVars: [],
      steps: expect.arrayContaining([
        {
          phase: "migrate",
          app: "api",
          cwd: "apps/api",
          argv: ["vp", "run", "db:migrate:remote", "--env", "production"],
        },
      ]),
    });
  });

  test("--dry-run names the build variables it would forward and never prints their values", async () => {
    await project(FULL);

    const { lines } = await run(["--dry-run"], {
      VARS_JSON: JSON.stringify({ VITE_API_URL: "https://hidden.example.com", OTHER: "x" }),
    });

    expect(JSON.parse(lines.join("\n"))).toMatchObject({ buildVars: ["VITE_API_URL"] });
    expect(lines.join("\n")).not.toContain("hidden.example.com");
  });

  test("a run with credentials executes the plan and exits 0", async () => {
    await project(FULL);

    const { code, calls } = await run([], {
      CLOUDFLARE_API_TOKEN: "t",
      CLOUDFLARE_ACCOUNT_ID: "a",
    });

    expect(code).toBe(0);
    expect(calls).toHaveLength(9);
  });

  test("a failure is one line on the log and exit 1, and a flag it does not know is the same", async () => {
    await project(FULL);

    const noCredentials = await run([]);
    expect(noCredentials.code).toBe(1);
    expect(noCredentials.lines.join("\n")).toMatch(/^deploy: .*CLOUDFLARE_API_TOKEN/);
    expect(noCredentials.calls).toEqual([]);

    const unknown = await run(["--production"]);
    expect(unknown.code).toBe(1);
    expect(unknown.lines.join("\n")).toContain("--production");
  });
});

/** What `web/spa` ships: the one variable its build reads, typed as always there. */
const API_URL_REQUIRED = `/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
`;

/** The fronts of a project that installed `web/spa`, `web/ssr` and `web/static`: the SPA and the static site read `VITE_API_URL` when they build, the Worker does not. */
const FRONTS: readonly App[] = FULL.map((app) =>
  app.dir === "spa" || app.dir === "static" ? { ...app, viteEnv: API_URL_REQUIRED } : app,
);

describe("buildNeeds", () => {
  test("is each built app's required VITE_ variables: the ones its vite-env.d.ts types without a question mark", async () => {
    await project(FRONTS);

    expect(await buildNeeds(root)).toEqual({
      "apps/spa": ["VITE_API_URL"],
      "apps/static": ["VITE_API_URL"],
    });
  });

  test("is empty for a project whose apps declare none, which is every project that needs no variable to build", async () => {
    await project(FULL);

    expect(await buildNeeds(root)).toEqual({});
  });

  test("leaves out an optional variable, a variable that is not Vite's, and what is not in ImportMetaEnv", async () => {
    await project([
      {
        dir: "spa",
        wrangler: pages("my-app-spa"),
        scripts: SCRIPTS,
        viteEnv: `/// <reference types="vite/client" />

interface Unrelated {
  readonly VITE_NOT_THE_ENV: string;
}

interface ImportMetaEnv {
  // readonly VITE_COMMENTED_OUT: string;
  readonly VITE_ANALYTICS_ID?: string;
  readonly API_URL: string;
  readonly VITE_B: string;
  readonly VITE_A: string;
}

// A second declaration merges with the first.
interface ImportMetaEnv {
  VITE_C: string;
}
`,
      },
    ]);

    expect(await buildNeeds(root)).toEqual({ "apps/spa": ["VITE_A", "VITE_B", "VITE_C"] });
  });

  test("reads a declaration in any source file of the app: web/spa types VITE_API_URL in src/lib/api.ts, beside the client that reads it", async () => {
    await project([{ dir: "spa", wrangler: pages("my-app-spa"), scripts: SCRIPTS, viteEnv: "" }]);
    await write(
      "apps/spa/src/lib/api.ts",
      `declare global {\n  interface ImportMetaEnv {\n    readonly VITE_API_URL: string;\n  }\n}\n`,
    );

    expect(await buildNeeds(root)).toEqual({ "apps/spa": ["VITE_API_URL"] });
  });

  test("an app that is not built has no need, and an app without a vite-env.d.ts none either", async () => {
    await project([
      {
        dir: "api",
        wrangler: worker("my-app-api"),
        scripts: { deploy: "wrangler deploy" },
        viteEnv: API_URL_REQUIRED,
      },
      { dir: "ssr", wrangler: worker("my-app-ssr"), scripts: SCRIPTS },
    ]);

    expect(await buildNeeds(root)).toEqual({});
  });
});

describe("a deploy that would build a front without the variable it needs", () => {
  const CREDENTIALS = { CLOUDFLARE_API_TOKEN: "token", CLOUDFLARE_ACCOUNT_ID: "account" };

  function recorder() {
    const calls: Step[] = [];
    const run: Runner = async (step) => {
      calls.push(step);
      return 0;
    };
    return { calls, run };
  }

  test("is refused before any build, naming each app and the variable, whatever else the environment holds", async () => {
    await project(FRONTS);

    for (const VARS_JSON of [
      undefined,
      "{}",
      JSON.stringify({ API_URL: "https://api.example.com" }),
    ]) {
      const { calls, run } = recorder();

      await expect(deploy(root, { ...CREDENTIALS, VARS_JSON }, run, () => {})).rejects.toThrow(
        /apps\/spa.*VITE_API_URL.*apps\/static.*VITE_API_URL/s,
      );

      expect(calls).toEqual([]);
    }
  });

  test("tells where the variable is set: a variable of the cloudflare GitHub environment, not a secret", async () => {
    await project(FRONTS);

    await expect(deploy(root, CREDENTIALS, recorder().run, () => {})).rejects.toThrow(
      /variables? of the `cloudflare` GitHub environment/,
    );
  });

  test("treats an empty variable as missing: a front built with it throws at load all the same", async () => {
    await project(FRONTS);
    const { calls, run } = recorder();

    await expect(
      deploy(
        root,
        { ...CREDENTIALS, VARS_JSON: JSON.stringify({ VITE_API_URL: "" }) },
        run,
        () => {},
      ),
    ).rejects.toThrow(/VITE_API_URL/);

    expect(calls).toEqual([]);
  });

  test("is not refused when the environment's variables have it, and every build gets it", async () => {
    await project(FRONTS);
    const seen: Record<string, string | undefined>[] = [];

    await deploy(
      root,
      { ...CREDENTIALS, VARS_JSON: JSON.stringify({ VITE_API_URL: "https://api.example.com" }) },
      async (step, env) => {
        if (step.phase === "build") {
          seen.push({ [step.app]: env.VITE_API_URL });
        }
        return 0;
      },
      () => {},
    );

    expect(seen).toEqual([
      { api: "https://api.example.com" },
      { spa: "https://api.example.com" },
      { ssr: "https://api.example.com" },
      { static: "https://api.example.com" },
    ]);
  });

  test("is not refused when a local run has the variable in its own environment", async () => {
    await project(FRONTS);
    const { calls, run } = recorder();

    await deploy(root, { ...CREDENTIALS, VITE_API_URL: "https://api.example.com" }, run, () => {});

    expect(calls).toHaveLength(9);
  });

  test("a project whose apps need nothing is deployed as it always was, with no variable", async () => {
    await project(FULL);
    const { calls, run } = recorder();

    await deploy(root, CREDENTIALS, run, () => {});

    expect(calls).toHaveLength(9);
  });

  test("never prints a value the environment held", async () => {
    await project(FRONTS);
    const lines: string[] = [];

    const code = await main([], {
      root,
      env: { ...CREDENTIALS, VARS_JSON: JSON.stringify({ OTHER: "hunter2-is-not-for-logs" }) },
      run: async () => 0,
      log: (line) => lines.push(line),
    });

    expect(code).toBe(1);
    expect(lines.join("\n")).toContain("VITE_API_URL");
    expect(lines.join("\n")).not.toContain("hunter2");
    expect(lines.join("\n")).not.toContain("token");
  });

  describe("--dry-run, which the validate job runs with no variables to check them against", () => {
    async function dryRun(env: Record<string, string | undefined>) {
      const lines: string[] = [];
      const code = await main(["--dry-run"], {
        root,
        env,
        run: async () => 0,
        log: (line) => lines.push(line),
      });
      return { code, output: lines.join("\n") };
    }

    test("lists the variables each build needs, and passes, when it is handed none", async () => {
      await project(FRONTS);

      const { code, output } = await dryRun({});

      expect(code).toBe(0);
      expect(JSON.parse(output)).toMatchObject({
        requiredBuildVars: { "apps/spa": ["VITE_API_URL"], "apps/static": ["VITE_API_URL"] },
      });
    });

    test("refuses when it is handed the environment's variables and one is missing, naming it", async () => {
      await project(FRONTS);

      for (const VARS_JSON of ["{}", JSON.stringify({ VITE_API_URL: "" })]) {
        const { code, output } = await dryRun({ VARS_JSON });

        expect(code).toBe(1);
        expect(output).toMatch(/apps\/spa.*VITE_API_URL.*apps\/static.*VITE_API_URL/s);
      }
    });

    test("passes when the variables it is handed have every one, and prints no value", async () => {
      await project(FRONTS);

      const { code, output } = await dryRun({
        VARS_JSON: JSON.stringify({ VITE_API_URL: "https://hidden.example.com" }),
      });

      expect(code).toBe(0);
      expect(output).not.toContain("hidden.example.com");
      expect(JSON.parse(output)).toMatchObject({ buildVars: ["VITE_API_URL"] });
    });
  });
});
