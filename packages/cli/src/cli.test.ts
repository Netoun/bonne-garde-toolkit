import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { addItems } from "./add";
import { createProject } from "./create";
import { findRepoRoot } from "./paths";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function repoRoot(): string {
  const root = findRepoRoot();
  if (!root) {
    throw new Error("repo root not found");
  }
  return root;
}

async function freshProject(prefix: string): Promise<string> {
  const parent = await mkdtemp(join(tmpdir(), prefix));
  dirs.push(parent);
  return createProject({
    name: "cli-app",
    cwd: parent,
    git: false,
    install: false,
    registry: `local:${join(repoRoot(), "registry")}`,
  });
}

/** Runs the real `bg` entry in `cwd`, the way a consumer does. */
async function runBg(cwd: string, ...args: string[]) {
  const proc = Bun.spawn(["bun", join(repoRoot(), "packages/cli/src/bin.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

describe("bg add --yes", () => {
  test("is accepted as a flag, not read as an item name", async () => {
    const target = await freshProject("bg-cli-yes-");
    const { stdout, stderr, code } = await runBg(
      target,
      "add",
      "ui/shadcn",
      "button",
      "--yes",
      "--no-install",
    );
    expect(stderr).not.toContain("unknown registry item");
    expect(code).toBe(0);
    const added = JSON.parse(stdout);
    expect(added).toMatchObject({ dryRun: false, items: ["utils", "animations", "button"] });
    // meta.bg is gone, and its `capabilities` list with it.
    expect(added).not.toHaveProperty("capabilities");
  });

  test("an item that needs the ui module fails without it, naming ui/shadcn and the command to run", async () => {
    const target = await freshProject("bg-cli-no-ui-");
    const before = await readFile(join(target, "bg.json"), "utf8");

    const { stdout, stderr, code } = await runBg(target, "add", "button", "--yes", "--no-install");

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain(
      "button needs the ui module, and none is installed or named in this call; run: bg add ui/shadcn button",
    );
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
  });

  test("is documented in --help", async () => {
    const { stdout, code } = await runBg(repoRoot(), "--help");
    expect(code).toBe(0);
    expect(stdout).toMatch(/bg add .*--yes/);
  });
});

describe("bg doctor", () => {
  const BUTTON = "packages/ui/src/components/button.tsx";

  async function projectWithButton(prefix: string): Promise<string> {
    const target = await freshProject(prefix);
    await addItems({ projectRoot: target, items: ["ui/shadcn", "button"], install: false });
    return target;
  }

  test("--strict exits 0 right after a clean add", async () => {
    const target = await projectWithButton("bg-cli-doctor-clean-");
    const { stdout, stderr, code } = await runBg(target, "doctor", "--strict");
    expect(stderr).toBe("");
    expect(code).toBe(0);
    expect(stdout).toContain("result: ok");
  });

  test("names a modified file as user-modified; only --strict exits non-zero", async () => {
    const target = await projectWithButton("bg-cli-doctor-mod-");
    await writeFile(join(target, BUTTON), "// mine now\n");

    const plain = await runBg(target, "doctor");
    expect(plain.code).toBe(0);
    expect(plain.stdout).toContain(BUTTON);
    expect(plain.stdout).toContain("user-modified");

    const strict = await runBg(target, "doctor", "--strict");
    expect(strict.code).toBe(1);
    expect(strict.stdout).toContain(BUTTON);
  });

  test("reports a deleted file as missing, and exits non-zero without --strict", async () => {
    const target = await projectWithButton("bg-cli-doctor-del-");
    await unlink(join(target, BUTTON));

    const { stdout, code } = await runBg(target, "doctor");

    expect(code).toBe(1);
    expect(stdout).toContain(`${BUTTON} is missing`);
  });

  test("--json prints the report of all six checks, and the exit code does not change", async () => {
    const target = await projectWithButton("bg-cli-doctor-json-");
    await writeFile(join(target, BUTTON), "// mine now\n");

    const { stdout, code } = await runBg(target, "doctor", "--json", "--strict");

    expect(code).toBe(1);
    const parsed = JSON.parse(stdout) as {
      status: string;
      checks: Record<string, { status: string; findings: { code: string; path?: string }[] }>;
    };
    expect(Object.keys(parsed.checks)).toEqual([
      "manifest",
      "files",
      "regions",
      "patches",
      "intentions",
      "peers",
    ]);
    expect(parsed.status).toBe("warning");
    expect(parsed.checks.files?.findings).toEqual([
      expect.objectContaining({ code: "file-modified", path: BUTTON }),
    ]);

    expect((await runBg(target, "doctor", "--json")).code).toBe(0);
  });

  test("an argument it does not know fails, so a typo cannot pass a CI gate", async () => {
    const target = await projectWithButton("bg-cli-doctor-typo-");
    const { stderr, code } = await runBg(target, "doctor", "--strcit");
    expect(code).toBe(1);
    expect(stderr).toContain("--strcit");
  });

  test("is listed in --help", async () => {
    const { stdout } = await runBg(repoRoot(), "--help");
    expect(stdout).toMatch(/bg doctor \[--json\] \[--strict\]/);
  });
});

describe("bg record", () => {
  async function stageUpgrade(target: string, file: string, id: string): Promise<void> {
    await mkdir(join(target, ".bg/upgrade"), { recursive: true });
    await writeFile(
      join(target, ".bg/upgrade", file),
      `---\nid: ${id}\ndomain: tooling\nclassification: migration\n---\n\n# ${id}\n`,
    );
  }

  async function intentionsOf(target: string): Promise<{
    applied: string[];
    skipped: Record<string, string>;
  }> {
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      platform: { intentions: { applied: string[]; skipped: Record<string, string> } };
    };
    return bg.platform.intentions;
  }

  test("a pending intention becomes applied, or skipped with its reason, in bg.json and in doctor", async () => {
    const target = await freshProject("bg-cli-record-");
    await addItems({ projectRoot: target, items: ["ui/shadcn", "button"], install: false });
    await stageUpgrade(target, "00-align-bun-pin.md", "v0.2.0/align-bun-pin");
    await stageUpgrade(target, "01-adopt-x.md", "v0.2.0/adopt-x");

    const pending = await runBg(target, "doctor", "--strict");
    expect(pending.code).toBe(1);
    expect(pending.stdout).toContain("2 pending");
    expect(pending.stdout).toContain("v0.2.0/align-bun-pin");

    const applied = await runBg(target, "record", "v0.2.0/align-bun-pin");
    expect(applied.code).toBe(0);
    expect(applied.stdout).toContain("v0.2.0/align-bun-pin");
    expect(applied.stderr).toBe("");
    expect(await intentionsOf(target)).toEqual({ applied: ["v0.2.0/align-bun-pin"], skipped: {} });

    const half = await runBg(target, "doctor", "--json");
    const halfReport = JSON.parse(half.stdout) as {
      checks: { intentions: { details: { applied: string[]; pending: { id: string }[] } } };
    };
    expect(halfReport.checks.intentions.details.applied).toEqual(["v0.2.0/align-bun-pin"]);
    expect(halfReport.checks.intentions.details.pending.map((p) => p.id)).toEqual([
      "v0.2.0/adopt-x",
    ]);

    const skipped = await runBg(
      target,
      "record",
      "v0.2.0/adopt-x",
      "--skip",
      "capability not installed",
    );
    expect(skipped.code).toBe(0);
    expect(await intentionsOf(target)).toEqual({
      applied: ["v0.2.0/align-bun-pin"],
      skipped: { "v0.2.0/adopt-x": "capability not installed" },
    });

    const done = await runBg(target, "doctor", "--strict");
    expect(done.code).toBe(0);
    expect(done.stdout).toContain("1 applied, 1 skipped, 0 pending");
  });

  test("an install intention lands on its module's record and doctor reads it from there", async () => {
    const target = await freshProject("bg-cli-record-module-");
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const record = {
      id: "better-auth",
      variant: "default",
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
      options: {},
      patches: [],
      intentions: { applied: [], skipped: {} },
    };
    await writeFile(
      join(target, "bg.json"),
      `${JSON.stringify({ ...bg, modules: { auth: [record] } }, null, 2)}\n`,
    );
    await mkdir(join(target, ".bg/add"), { recursive: true });
    await writeFile(
      join(target, ".bg/add/01-wire-auth-into-api.md"),
      "---\nid: auth/better-auth/wire-auth-into-api\ndomain: auth\nclassification: migration\n---\n",
    );

    const { stdout, stderr, code } = await runBg(
      target,
      "record",
      "auth/better-auth/wire-auth-into-api",
      "--skip",
      "no api app yet",
    );

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toContain("in auth/better-auth");
    const after = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      modules: { auth: { intentions: unknown }[] };
      platform: { intentions: unknown };
    };
    expect(after.modules.auth[0]?.intentions).toEqual({
      applied: [],
      skipped: { "auth/better-auth/wire-auth-into-api": "no api app yet" },
    });
    expect(after.platform.intentions).toEqual({ applied: [], skipped: {} });
    // the peers check cannot reach a module.json for this fixture, which is a note, so strict stays green
    expect((await runBg(target, "doctor", "--strict")).code).toBe(0);
  });

  test("an id that was never staged is recorded, with a warning on stderr", async () => {
    const target = await freshProject("bg-cli-record-unstaged-");
    const { stdout, stderr, code } = await runBg(target, "record", "v0.2.0/align-bun-pin");
    expect(code).toBe(0);
    expect(stdout).toContain("v0.2.0/align-bun-pin");
    expect(stderr).toContain("not staged");
    expect((await intentionsOf(target)).applied).toEqual(["v0.2.0/align-bun-pin"]);
  });

  test("a bad id, a missing module, a missing id or a bare --skip fail and leave bg.json as it was", async () => {
    const target = await freshProject("bg-cli-record-bad-");
    const before = await readFile(join(target, "bg.json"), "utf8");

    const cases: [string[], RegExp][] = [
      [["record", "align-bun-pin"], /canonical intention id/],
      [["record", "auth/better-auth/wire"], /auth\/better-auth is not installed/],
      [["record"], /requires an intention id/],
      [["record", "v0.2.0/x", "--skip"], /missing value for --skip/],
      [["record", "v0.2.0/x", "--skip", ""], /missing value for --skip/],
      [["record", "v0.2.0/x", "extra"], /unexpected argument: extra/],
    ];
    for (const [args, message] of cases) {
      const { stderr, code } = await runBg(target, ...args);
      expect(code).toBe(1);
      expect(stderr).toMatch(message);
    }
    expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
  });

  test("a v1 bg.json is rewritten as v2, and says so, like add", async () => {
    const target = await freshProject("bg-cli-record-v1-");
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as Record<
      string,
      unknown
    >;
    const { apps: _apps, modules: _modules, items, files: _files, regions: _regions, ...rest } = bg;
    await writeFile(
      join(target, "bg.json"),
      `${JSON.stringify({ ...rest, version: 1, installed: items, capabilities: [] }, null, 2)}\n`,
    );

    const { stderr, code } = await runBg(target, "record", "v0.2.0/align-bun-pin");

    expect(code).toBe(0);
    expect(stderr).toContain("rewrote bg.json from version 1 to version 2");
    const after = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      version: number;
    };
    expect(after.version).toBe(2);
  });

  test("is listed in --help", async () => {
    const { stdout } = await runBg(repoRoot(), "--help");
    expect(stdout).toMatch(/bg record <intention-id> \[--skip "<reason>"\]/);
  });
});

/** Every path under `root` with its content, so two trees compare whole. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        out[`${relative(root, path)}/`] = "<dir>";
        await walk(path);
      } else {
        out[relative(root, path)] = await readFile(path, "utf8");
      }
    }
  };
  await walk(root);
  return out;
}

type ModuleOutput = {
  dryRun: boolean;
  written: string[];
  skippedIdentical: string[];
  kept: string[];
  tookOver: { path: string; from: string; by: string }[];
  modules: {
    module: string;
    variant: string;
    files: string[];
    env: { name: string; required: boolean; status: string }[];
    checks: string[];
    workspace: string | null;
    dependencies: Record<string, string>;
    devDependencies: Record<string, string>;
    patches: PatchOutput[];
  }[];
  failedPatches: (PatchOutput & { module: string })[];
  pendingIntentions: {
    id: string;
    module: string;
    type: string;
    file: string;
    intent: string;
    reason: string;
    staged: string | null;
  }[];
  session: string | null;
};

type PatchOutput = {
  type: string;
  file: string;
  status: string;
  reason?: string;
  intention?: string;
  regions: { region: string; status: string; replaced?: string | null }[];
};

/** What `provider/cloudflare` writes, in the order `bg add` prints it. */
const CLOUDFLARE_FILES = [
  "packages/api-runtime/package.json",
  "packages/api-runtime/src/index.test.ts",
  "packages/api-runtime/src/index.ts",
  "packages/api-runtime/tsconfig.json",
  "packages/api-runtime/tsconfig.test.json",
];

describe("bg add <module>", () => {
  test("installs the cloudflare provider by its bare id: files, env, records, and doctor is green", async () => {
    const target = await freshProject("bg-cli-mod-cf-");

    const { stdout, stderr, code } = await runBg(
      target,
      "add",
      "cloudflare",
      "--yes",
      "--no-install",
    );

    // `add` prints the checks the module declares and does not run them (050 step 15).
    expect(stderr).toContain("checks were not run");
    expect(stderr).toContain("cd packages/api-runtime && bun run typecheck && bun run test");
    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.written).toEqual(CLOUDFLARE_FILES);
    expect(out.modules).toEqual([
      expect.objectContaining({
        module: "provider/cloudflare",
        variant: "default",
        files: CLOUDFLARE_FILES,
        workspace: "packages/api-runtime",
        dependencies: { elysia: "1.4.29" },
        env: [
          { name: "BETTER_AUTH_SECRET", required: true, status: "added" },
          { name: "RESEND_API_KEY", required: true, status: "added" },
        ],
      }),
    ]);

    const template = await readFile(
      join(
        repoRoot(),
        "registry/modules/provider/cloudflare/template/packages/api-runtime/src/index.ts",
      ),
      "utf8",
    );
    expect(await readFile(join(target, "packages/api-runtime/src/index.ts"), "utf8")).toBe(
      template,
    );
    // 035: the vendored package.json carries exports and scripts, and the variant's maps are merged in.
    expect(
      JSON.parse(await readFile(join(target, "packages/api-runtime/package.json"), "utf8")),
    ).toMatchObject({
      name: "@cli-app/api-runtime",
      exports: { ".": "./src/index.ts" },
      scripts: { test: "bun test" },
      dependencies: { elysia: "1.4.29" },
      devDependencies: { "@cloudflare/workers-types": "5.20260804.1", "@types/node": "26.1.2" },
    });
    // 035 (d): a provider writes nothing under apps/*; the Worker's wrangler.jsonc is the api module's.
    expect(out.written.filter((path) => path.startsWith("apps/"))).toEqual([]);
    expect(await readFile(join(target, ".env.example"), "utf8")).toBe(
      "BETTER_AUTH_SECRET=\nRESEND_API_KEY=\n",
    );

    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      modules: Record<string, Record<string, unknown>[]>;
      files: Record<string, { owner: string; sha256: string }>;
      regions: Record<string, Record<string, string>>;
    };
    expect(bg.modules.provider).toEqual([
      expect.objectContaining({
        id: "cloudflare",
        variant: "default",
        version: "0.1.0",
        options: {},
        patches: [],
        intentions: { applied: [], skipped: {} },
      }),
    ]);
    expect(bg.files["packages/api-runtime/src/index.ts"]?.owner).toBe("provider/cloudflare");
    expect(bg.regions[".env.example"]).toEqual({
      BETTER_AUTH_SECRET: "provider/cloudflare",
      RESEND_API_KEY: "provider/cloudflare",
    });

    const doctor = await runBg(target, "doctor", "--strict");
    expect(doctor.code).toBe(0);
    expect(doctor.stdout).toContain("result: ok");
  });

  test("the qualified name does the same, and a second add is idempotent", async () => {
    const target = await freshProject("bg-cli-mod-twice-");
    await runBg(target, "add", "provider/cloudflare", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stdout, code } = await runBg(
      target,
      "add",
      "provider/cloudflare",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.written).toEqual([]);
    expect(out.skippedIdentical).toEqual(CLOUDFLARE_FILES);
    expect(out.kept).toEqual([]);
    expect(out.modules[0]?.env.map((key) => key.status)).toEqual(["present", "present"]);
    const after = await snapshot(target);
    const withoutInstalledAt = (tree: Record<string, string>) =>
      (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"');
    expect({ ...after, "bg.json": withoutInstalledAt(after) }).toEqual({
      ...before,
      "bg.json": withoutInstalledAt(before),
    });
  });

  test("a second provider fails on cardinality, pointing at bg replace, and changes nothing", async () => {
    const target = await freshProject("bg-cli-mod-card-");
    await runBg(target, "add", "cloudflare", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stderr, code } = await runBg(target, "add", "dockerfile", "--yes", "--no-install");

    expect(code).toBe(1);
    expect(stderr).toContain("provider is already filled by provider/cloudflare");
    expect(stderr).toContain("bg replace provider/dockerfile");
    expect(await snapshot(target)).toEqual(before);
  });

  test("two providers in one call fail before anything is written", async () => {
    const target = await freshProject("bg-cli-mod-card2-");
    const before = await snapshot(target);

    const { stderr, code } = await runBg(target, "add", "cloudflare", "dockerfile", "--no-install");

    expect(code).toBe(1);
    expect(stderr).toContain("provider admits one module");
    expect(await snapshot(target)).toEqual(before);
  });

  test("--dry-run prints the plan and writes nothing", async () => {
    const target = await freshProject("bg-cli-mod-dry-");
    const before = await snapshot(target);

    const { stdout, code } = await runBg(target, "add", "dockerfile", "--dry-run", "--yes");

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.dryRun).toBe(true);
    expect(out.written).toEqual([
      ".dockerignore",
      "Dockerfile",
      "compose.yaml",
      "packages/api-runtime/package.json",
      "packages/api-runtime/src/index.test.ts",
      "packages/api-runtime/src/index.ts",
      "packages/api-runtime/tsconfig.json",
    ]);
    expect(out.modules[0]?.env.map((key) => key.name)).toEqual([
      "PORT",
      "DATA_DIR",
      "APP_URL",
      "BETTER_AUTH_SECRET",
      "RESEND_API_KEY",
    ]);
    expect(await snapshot(target)).toEqual(before);
  });

  test("renders the project's scope into the dockerfile module, and its Dockerfile builds with the root script", async () => {
    const target = await freshProject("bg-cli-mod-scope-");

    await runBg(target, "add", "dockerfile", "--yes", "--no-install");

    const runtime = JSON.parse(
      await readFile(join(target, "packages/api-runtime/package.json"), "utf8"),
    ) as { name: string; dependencies: Record<string, string> };
    expect(runtime.name).toBe("@cli-app/api-runtime");
    expect(runtime.dependencies).toEqual({ elysia: "1.4.29" });
    // 09 (c): a project with no SPA workspace has to build, so no `--filter '<scope>/spa'`.
    const dockerfile = await readFile(join(target, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("RUN bun run build\n");
    expect(dockerfile).not.toContain("--filter");
    expect(dockerfile).not.toContain("{{SCOPE}}");
  });

  test("an item and a module go in one call, items first in the output", async () => {
    const target = await freshProject("bg-cli-mod-mixed-");

    const { stdout, code } = await runBg(
      target,
      "add",
      "portless",
      "dockerfile",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput & { items: string[] };
    expect(out.items).toEqual(["portless"]);
    expect(out.modules.map((m) => m.module)).toEqual(["provider/dockerfile"]);
  });

  test("an unknown name fails with suggestions from both catalogs", async () => {
    const target = await freshProject("bg-cli-mod-unknown-");

    const { stderr, code } = await runBg(target, "add", "cloud", "--no-install");

    expect(code).toBe(1);
    expect(stderr).toContain("unknown name: cloud");
    expect(stderr).toContain("provider/cloudflare");
  });

  test("--set, bg remove and bg replace say they are not supported yet instead of doing nothing", async () => {
    const target = await freshProject("bg-cli-mod-todo-");

    const set = await runBg(target, "add", "cloudflare", "--set", "a=b");
    expect(set.code).toBe(1);
    expect(set.stderr).toContain("--set is not supported yet");

    for (const command of ["remove", "replace"]) {
      const result = await runBg(target, command, "cloudflare");
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(`bg ${command} is not supported yet`);
    }
  });
});

describe("bg add config/branding: scripts.merge, the first tier-2 patch (060)", () => {
  const SCRIPT = "bun packages/config/scripts/gen-branding.ts";
  const REGION = "scripts.gen:branding";

  async function rootScripts(target: string): Promise<Record<string, string>> {
    const body = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    return body.scripts;
  }

  test("adds the root script, and the JSON says per module and per region what the patch did", async () => {
    const target = await freshProject("bg-cli-patch-");
    const before = await readFile(join(target, "package.json"), "utf8");

    const { stdout, stderr, code } = await runBg(
      target,
      "add",
      "config/branding",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    expect(stderr).toContain("checks were not run");
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "applied",
        regions: [{ region: REGION, status: "applied" }],
      },
    ]);
    expect(out.failedPatches).toEqual([]);
    // The file the patch edited is not one the module wrote.
    expect(out.written).not.toContain("package.json");

    expect((await rootScripts(target))["gen:branding"]).toBe(SCRIPT);
    expect(await readFile(join(target, "package.json"), "utf8")).toBe(
      before.replace(
        '    "prepare": "husky"\n',
        `    "prepare": "husky",\n    "gen:branding": "${SCRIPT}"\n`,
      ),
    );
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      regions: Record<string, Record<string, string>>;
      modules: { config: { patches: unknown[] }[] };
    };
    expect(bg.regions["package.json"]).toEqual({ [REGION]: "config/branding" });
    expect(bg.modules.config[0]?.patches).toEqual([
      { type: "scripts.merge", file: "package.json", status: "applied" },
    ]);
    const doctor = await runBg(target, "doctor", "--strict");
    expect(doctor.code).toBe(0);
  });

  test("the same add again reports the patch skipped, and the project is the same bytes", async () => {
    const target = await freshProject("bg-cli-patch-twice-");
    await runBg(target, "add", "config/branding", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stdout, code } = await runBg(target, "add", "config/branding", "--yes", "--no-install");

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "skipped",
        regions: [{ region: REGION, status: "skipped" }],
      },
    ]);
    expect(out.written).toEqual([]);
    // `installedAt` is the one thing a re-add moves in bg.json: the record keeps `applied`.
    const settled = (tree: Record<string, string>) => ({
      ...tree,
      "bg.json": (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"'),
    });
    expect(settled(await snapshot(target))).toEqual(settled(before));
  });

  test("a hand-edited script is refused, naming the region and --force, and --force puts it back", async () => {
    const target = await freshProject("bg-cli-patch-edit-");
    await runBg(target, "add", "config/branding", "--yes", "--no-install");
    const clean = await readFile(join(target, "package.json"), "utf8");
    await writeFile(join(target, "package.json"), clean.replace(SCRIPT, "bun my-own.ts"));
    const edited = await snapshot(target);

    const refused = await runBg(target, "add", "config/branding", "--yes", "--no-install");

    expect(refused.code).toBe(1);
    expect(refused.stderr).toContain(`${REGION} of package.json is "bun my-own.ts"`);
    expect(refused.stderr).toContain("--force");
    expect(await snapshot(target)).toEqual(edited);

    const forced = await runBg(
      target,
      "add",
      "config/branding",
      "--yes",
      "--no-install",
      "--force",
    );

    expect(forced.code).toBe(0);
    expect((JSON.parse(forced.stdout) as ModuleOutput).modules[0]?.patches[0]?.regions).toEqual([
      { region: REGION, status: "applied", replaced: "bun my-own.ts" },
    ]);
    expect(await readFile(join(target, "package.json"), "utf8")).toBe(clean);
  });

  test("a patch that cannot apply is a pending intention: staged, reported by doctor, closed by bg record, and the install completes", async () => {
    const target = await freshProject("bg-cli-patch-failed-");
    const root = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify({ ...root, scripts: "nope" }, null, 2)}\n`,
    );

    const { stdout, stderr, code } = await runBg(
      target,
      "add",
      "config/branding",
      "--yes",
      "--no-install",
    );

    // The install completes: 060 says a failed patch never aborts it.
    expect(code).toBe(0);
    expect(await readFile(join(target, "packages/config/src/index.ts"), "utf8")).toContain(
      "branding",
    );
    const id = "config/branding/patch-scripts-merge-package-json-scripts-gen-branding";
    const out = JSON.parse(stdout) as ModuleOutput;
    const failed = {
      module: "config/branding",
      type: "scripts.merge",
      file: "package.json",
      status: "failed",
      reason: 'package.json: "scripts" is a string, not an object',
      intention: id,
      regions: [],
    };
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "failed",
        reason: failed.reason,
        intention: id,
        regions: [],
      },
    ]);
    expect(out.failedPatches).toEqual([failed]);
    expect(out.pendingIntentions).toEqual([
      {
        id,
        module: "config/branding",
        type: "scripts.merge",
        file: "package.json",
        intent:
          'The scripts.merge patch of config/branding makes package.json hold: scripts.gen:branding = "bun packages/config/scripts/gen-branding.ts".',
        reason: failed.reason,
        staged: `.bg/add/01-${id.split("/")[2]}.md`,
      },
    ]);
    expect(out.session).toBe(".bg/add/session.md");
    // Never silent: the failure, the id, and where to start.
    expect(stderr).toContain("bg: PATCH FAILED scripts.merge on package.json (config/branding)");
    expect(stderr).toContain(failed.reason);
    expect(stderr).toContain(`pending intention ${id}`);
    expect(stderr).toContain("read .bg/add/session.md");
    expect(stderr).not.toContain("not implemented");

    // The staged intention and the entry point are on disk, and what bg.json keeps is durable.
    const staged = await readFile(join(target, out.pendingIntentions[0]?.staged ?? ""), "utf8");
    expect(staged).toContain(`id: ${id}`);
    expect(staged).toContain(failed.reason);
    expect(await readFile(join(target, ".bg/add/session.md"), "utf8")).toContain(id);
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      modules: { config: { patches: unknown[] }[] };
    };
    expect(bg.modules.config[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        status: "failed",
        reason: failed.reason,
        intention: id,
      },
    ]);

    // doctor: one finding for the failure, pending, and --strict fails on it.
    const doctor = await runBg(target, "doctor", "--strict");
    expect(doctor.code).toBe(1);
    expect(doctor.stdout).toContain("intention-pending");
    expect(doctor.stdout).toContain(id);
    expect(doctor.stdout).toContain(failed.reason);
    expect(doctor.stdout).not.toContain("patch-failed");
    expect((await runBg(target, "doctor")).code).toBe(0);

    // The same add again is the same intention in the same file: nothing staged moves.
    const staging = async () =>
      (await snapshot(target))[out.pendingIntentions[0]?.staged ?? ""] ?? "missing";
    const before = await staging();
    const again = await runBg(target, "add", "config/branding", "--yes", "--no-install");
    expect(again.code).toBe(0);
    expect(await staging()).toBe(before);

    // bg record closes it, and the failed patch it came from is no longer a finding.
    const recorded = await runBg(target, "record", id, "--skip", "this project has no root script");
    expect(recorded.code).toBe(0);
    const closed = await runBg(target, "doctor", "--strict");
    expect(closed.code).toBe(0);
    expect(closed.stdout).not.toContain("intention-pending");
    // A resolved intention is not pending again on the next add, though the patch still fails.
    const last = await runBg(target, "add", "config/branding", "--yes", "--no-install");
    expect(last.code).toBe(0);
    expect((JSON.parse(last.stdout) as ModuleOutput).pendingIntentions).toEqual([]);
    expect((JSON.parse(last.stdout) as ModuleOutput).failedPatches).toHaveLength(1);
  });

  test("--dry-run reports the intention a failing patch would become, and stages nothing", async () => {
    const target = await freshProject("bg-cli-patch-dry-failed-");
    const root = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as Record<
      string,
      unknown
    >;
    await writeFile(
      join(target, "package.json"),
      `${JSON.stringify({ ...root, scripts: "nope" }, null, 2)}\n`,
    );
    const before = await snapshot(target);

    const { stdout, stderr, code } = await runBg(
      target,
      "add",
      "config/branding",
      "--dry-run",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.pendingIntentions.map(({ id, staged }) => [id, staged])).toEqual([
      ["config/branding/patch-scripts-merge-package-json-scripts-gen-branding", null],
    ]);
    expect(out.session).toBeNull();
    expect(stderr).toContain("dry run: nothing staged");
    expect(await snapshot(target)).toEqual(before);
  });

  test("--dry-run prints the patch and writes nothing", async () => {
    const target = await freshProject("bg-cli-patch-dry-");
    const before = await snapshot(target);

    const { stdout, code } = await runBg(
      target,
      "add",
      "config/branding",
      "--dry-run",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.dryRun).toBe(true);
    expect(out.modules[0]?.patches[0]).toMatchObject({
      type: "scripts.merge",
      status: "applied",
      regions: [{ region: REGION, status: "applied" }],
    });
    expect(await snapshot(target)).toEqual(before);
  });

  test("a module without a patch prints an empty list, and nothing on stderr about patches", async () => {
    const target = await freshProject("bg-cli-patch-none-");

    const { stdout, stderr } = await runBg(
      target,
      "add",
      "provider/cloudflare",
      "--yes",
      "--no-install",
    );

    expect((JSON.parse(stdout) as ModuleOutput).modules[0]?.patches).toEqual([]);
    expect(stderr).not.toContain("PATCH");
  });
});

describe("bg add api/elysia: a module that vendors a file and patches it (035, 060)", () => {
  const FILE = "apps/api/package.json";
  const DEV_CLOUDFLARE = "wrangler dev --port 5172";

  async function installed(prefix: string, provider: "cloudflare" | "dockerfile") {
    const target = await freshProject(prefix);
    const first = await runBg(
      target,
      "add",
      "config/branding",
      `provider/${provider}`,
      "api/elysia",
      "--yes",
      "--no-install",
    );
    expect(first.code).toBe(0);
    return { target, out: JSON.parse(first.stdout) as ModuleOutput };
  }

  async function scriptsOf(target: string): Promise<Record<string, string>> {
    const body = JSON.parse(await readFile(join(target, FILE), "utf8")) as {
      scripts: Record<string, string>;
    };
    return body.scripts;
  }

  test("the cloudflare variant writes wrangler.jsonc and patches dev and deploy, with no --force", async () => {
    const { target, out } = await installed("bg-cli-api-cf-", "cloudflare");

    const api = out.modules.find((module) => module.module === "api/elysia");
    expect(api?.variant).toBe("cloudflare");
    expect(api?.files).toContain("apps/api/wrangler.jsonc");
    expect(api?.patches).toEqual([
      {
        type: "scripts.merge",
        file: FILE,
        status: "applied",
        regions: [
          { region: "scripts.dev", status: "applied" },
          { region: "scripts.deploy", status: "applied" },
        ],
      },
    ]);
    expect(out.failedPatches).toEqual([]);
    // A file the module wrote and the patch then edited is in `written`, once.
    expect(out.written.filter((path) => path === FILE)).toEqual([FILE]);
    expect(await scriptsOf(target)).toMatchObject({
      dev: DEV_CLOUDFLARE,
      deploy: "wrangler deploy",
    });
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      regions: Record<string, Record<string, string>>;
      files: Record<string, { owner: string }>;
    };
    expect(bg.regions[FILE]).toEqual({
      "scripts.dev": "api/elysia",
      "scripts.deploy": "api/elysia",
    });
    expect(bg.files[FILE]?.owner).toBe("api/elysia");
    expect(bg.files["apps/api/wrangler.jsonc"]?.owner).toBe("api/elysia");
    // The provider owns the runtime package, and nothing it wrote is under apps/.
    expect(bg.files["packages/api-runtime/src/index.ts"]?.owner).toBe("provider/cloudflare");
    expect(
      Object.entries(bg.files).filter(
        ([path, { owner }]) => owner === "provider/cloudflare" && path.startsWith("apps/"),
      ),
    ).toEqual([]);
    const doctor = await runBg(target, "doctor", "--strict");
    expect(doctor.code).toBe(0);
  });

  test("the dockerfile variant writes no wrangler.jsonc, and a dev script that runs on Bun", async () => {
    const { target, out } = await installed("bg-cli-api-docker-", "dockerfile");

    const api = out.modules.find((module) => module.module === "api/elysia");
    expect(api?.variant).toBe("dockerfile");
    expect(api?.files).not.toContain("apps/api/wrangler.jsonc");
    expect(api?.devDependencies).toEqual({});
    expect(api?.patches[0]?.regions).toEqual([{ region: "scripts.dev", status: "applied" }]);
    const scripts = await scriptsOf(target);
    expect(scripts.dev).toBe("bun --watch src/index.ts");
    expect(scripts).not.toHaveProperty("deploy");
    expect((await runBg(target, "doctor", "--strict")).code).toBe(0);
  });

  test("the same add again reports every patch skipped, and the project is the same bytes", async () => {
    const { target } = await installed("bg-cli-api-twice-", "cloudflare");
    const before = await snapshot(target);

    const again = await runBg(target, "add", "api/elysia", "--yes", "--no-install");

    expect(again.code).toBe(0);
    const out = JSON.parse(again.stdout) as ModuleOutput;
    expect(out.modules[0]?.patches).toEqual([
      {
        type: "scripts.merge",
        file: FILE,
        status: "skipped",
        regions: [
          { region: "scripts.dev", status: "skipped" },
          { region: "scripts.deploy", status: "skipped" },
        ],
      },
    ]);
    expect(out.written).toEqual([]);
    const settled = (tree: Record<string, string>) => ({
      ...tree,
      "bg.json": (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"'),
    });
    expect(settled(await snapshot(target))).toEqual(settled(before));
  });

  test("a hand-edited region is user-owned: the re-add names it and writes nothing, and --force puts it back", async () => {
    const { target } = await installed("bg-cli-api-edit-", "cloudflare");
    const clean = await readFile(join(target, FILE), "utf8");
    await writeFile(join(target, FILE), clean.replace(DEV_CLOUDFLARE, "bun my-own-dev.ts"));
    const edited = await snapshot(target);

    const refused = await runBg(target, "add", "api/elysia", "--yes", "--no-install");

    expect(refused.code).toBe(1);
    // The region, as for a file the module only patches: not "apps/api/package.json was modified".
    expect(refused.stderr).toContain(
      `scripts.dev of ${FILE} is "bun my-own-dev.ts", which differs from what api/elysia declares ("${DEV_CLOUDFLARE}")`,
    );
    expect(refused.stderr).toContain("--force");
    expect(refused.stderr).not.toContain("was modified");
    expect(await snapshot(target)).toEqual(edited);

    const forced = await runBg(target, "add", "api/elysia", "--yes", "--no-install", "--force");

    expect(forced.code).toBe(0);
    const regions = (JSON.parse(forced.stdout) as ModuleOutput).modules[0]?.patches[0]?.regions;
    expect(regions).toContainEqual({
      region: "scripts.dev",
      status: "applied",
      replaced: "bun my-own-dev.ts",
    });
    expect(await readFile(join(target, FILE), "utf8")).toBe(clean);
  });

  test("an edit outside the regions is not a conflict: the re-add keeps the file and says so, --force or not", async () => {
    const { target } = await installed("bg-cli-api-file-", "cloudflare");
    const clean = await readFile(join(target, FILE), "utf8");
    const body = JSON.parse(clean) as Record<string, unknown>;
    const edited = `${JSON.stringify({ ...body, license: "MIT" }, null, 2)}\n`;
    await writeFile(join(target, FILE), edited);

    for (const flags of [[], ["--force"]]) {
      const again = await runBg(target, "add", "api/elysia", "--yes", "--no-install", ...flags);

      expect(again.code).toBe(0);
      const out = JSON.parse(again.stdout) as ModuleOutput;
      expect(out.kept).toEqual([FILE]);
      expect(out.written).toEqual([]);
      expect(out.modules[0]?.patches[0]?.status).toBe("skipped");
      expect(await readFile(join(target, FILE), "utf8")).toBe(edited);
    }
  });

  test("without a provider it fails naming the category, and without the config module it names that", async () => {
    const target = await freshProject("bg-cli-api-peers-");

    const noProvider = await runBg(target, "add", "config/branding", "api/elysia", "--no-install");
    expect(noProvider.code).toBe(1);
    expect(noProvider.stderr).toContain(
      "api/elysia needs a module in category provider (any) and none is installed",
    );

    const noConfig = await runBg(
      target,
      "add",
      "provider/cloudflare",
      "api/elysia",
      "--no-install",
    );
    expect(noConfig.code).toBe(1);
    expect(noConfig.stderr).toContain(
      "api/elysia needs a module in category config (branding) and none is installed",
    );
    expect(await readdir(join(target, "apps"))).toEqual([".gitkeep"]);
  });
});
