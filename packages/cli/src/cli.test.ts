import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, unlink, writeFile } from "node:fs/promises";
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
