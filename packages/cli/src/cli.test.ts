import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
