import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    const { stdout, stderr, code } = await runBg(target, "add", "button", "--yes", "--no-install");
    expect(stderr).not.toContain("unknown registry item");
    expect(code).toBe(0);
    expect(JSON.parse(stdout)).toMatchObject({ dryRun: false, items: ["utils", "button"] });
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
    await addItems({ projectRoot: target, items: ["button"], install: false });
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
    await addItems({ projectRoot: target, items: ["button"], install: false });
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
