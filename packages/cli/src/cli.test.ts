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
  tookOver: { path: string; from: string; by: string }[];
  modules: {
    module: string;
    variant: string;
    files: string[];
    env: { name: string; required: boolean; status: string }[];
    checks: string[];
  }[];
};

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

    expect(stderr).toBe("");
    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput;
    expect(out.written).toEqual(["apps/api/wrangler.jsonc"]);
    expect(out.modules).toEqual([
      expect.objectContaining({
        module: "provider/cloudflare",
        variant: "default",
        files: ["apps/api/wrangler.jsonc"],
        env: [
          { name: "BETTER_AUTH_SECRET", required: true, status: "added" },
          { name: "RESEND_API_KEY", required: true, status: "added" },
        ],
      }),
    ]);

    const template = await readFile(
      join(repoRoot(), "registry/modules/provider/cloudflare/template/apps/api/wrangler.jsonc"),
      "utf8",
    );
    expect(await readFile(join(target, "apps/api/wrangler.jsonc"), "utf8")).toBe(template);
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
    expect(bg.files["apps/api/wrangler.jsonc"]?.owner).toBe("provider/cloudflare");
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
    expect(out.skippedIdentical).toEqual(["apps/api/wrangler.jsonc"]);
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
      "packages/api-runtime/src/index.test.ts",
      "packages/api-runtime/src/index.ts",
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

  test("renders the project's scope into the dockerfile module", async () => {
    const target = await freshProject("bg-cli-mod-scope-");

    await runBg(target, "add", "dockerfile", "--yes", "--no-install");

    const dockerfile = await readFile(join(target, "Dockerfile"), "utf8");
    expect(dockerfile).toContain("--filter '@cli-app/spa'");
    expect(dockerfile).not.toContain("{{SCOPE}}");
  });

  test("an item and a module go in one call, items first in the output", async () => {
    const target = await freshProject("bg-cli-mod-mixed-");

    const { stdout, code } = await runBg(
      target,
      "add",
      "api-elysia",
      "dockerfile",
      "--yes",
      "--no-install",
    );

    expect(code).toBe(0);
    const out = JSON.parse(stdout) as ModuleOutput & { items: string[] };
    expect(out.items).toEqual(["api-elysia"]);
    expect(out.modules.map((m) => m.module)).toEqual(["provider/dockerfile"]);
  });

  test("api-elysia and provider/cloudflare both own apps/api/wrangler.jsonc: refused, naming both, nothing written", async () => {
    const target = await freshProject("bg-cli-mod-trap-");
    await runBg(target, "add", "api-elysia", "--yes", "--no-install");
    const before = await snapshot(target);

    const { stderr, code } = await runBg(target, "add", "cloudflare", "--yes", "--no-install");

    expect(code).toBe(1);
    expect(stderr).toContain(
      "apps/api/wrangler.jsonc is owned by api-elysia, and provider/cloudflare would replace it",
    );
    expect(await snapshot(target)).toEqual(before);

    const sameCall = await freshProject("bg-cli-mod-trap2-");
    const both = await runBg(
      sameCall,
      "add",
      "api-elysia",
      "cloudflare",
      "--force",
      "--no-install",
    );
    expect(both.code).toBe(1);
    expect(both.stderr).toContain("named by both api-elysia and provider/cloudflare");
  });

  test("--force takes the file over, says so, and records the module as its owner", async () => {
    const target = await freshProject("bg-cli-mod-force-");
    await runBg(target, "add", "api-elysia", "--yes", "--no-install");

    const { stdout, code } = await runBg(target, "add", "cloudflare", "--force", "--no-install");

    expect(code).toBe(0);
    expect((JSON.parse(stdout) as ModuleOutput).tookOver).toEqual([
      { path: "apps/api/wrangler.jsonc", from: "api-elysia", by: "provider/cloudflare" },
    ]);
    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      files: Record<string, { owner: string }>;
    };
    expect(bg.files["apps/api/wrangler.jsonc"]?.owner).toBe("provider/cloudflare");
    expect((await runBg(target, "doctor", "--strict")).code).toBe(0);
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
