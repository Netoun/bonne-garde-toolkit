import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
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

/**
 * The real entry, run by the absolute path of the bun that runs this test, with a PATH that holds
 * nothing: no `bun` for `bun install` to find, and no `git` either.
 */
async function runWithoutBun(cwd: string, ...args: string[]) {
  const emptyPath = await mkdtemp(join(tmpdir(), "bg-no-path-"));
  dirs.push(emptyPath);
  const proc = Bun.spawn([process.execPath, join(repoRoot(), "packages/cli/src/bin.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, PATH: emptyPath },
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

/** The one line a Bonne Garde user without Bun reads: why it stopped, and what to do. Returns every line stderr has. */
function expectOneLineAboutBun(stderr: string): string[] {
  expect(stderr).not.toContain("ENOENT");
  expect(stderr).not.toContain("    at ");
  const lines = stderr.split("\n").filter((line) => line.trim() !== "");
  const [line, ...others] = lines.filter((candidate) => candidate.includes("needs Bun"));
  expect(others).toEqual([]);
  expect(line).toContain("needs Bun (https://bun.sh)");
  expect(line).toContain("files are written");
  expect(line).toContain("`bun install`");
  return lines;
}

describe("without bun on PATH", () => {
  test("create writes the project, says the project needs Bun, and exits non-zero", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bg-no-bun-create-"));
    dirs.push(parent);

    // `git init` is attempted too, and git is missing as well: that is no reason to stop.
    const { stdout, stderr, code } = await runWithoutBun(
      parent,
      "create",
      "no-bun-app",
      "--yes",
      "--registry",
      `local:${join(repoRoot(), "registry")}`,
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(expectOneLineAboutBun(stderr)).toHaveLength(1);
    expect(existsSync(join(parent, "no-bun-app/package.json"))).toBe(true);
    expect(existsSync(join(parent, "no-bun-app/bg.json"))).toBe(true);
  });

  test("create --no-install needs no Bun at all", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bg-no-bun-skip-"));
    dirs.push(parent);

    const { stderr, code } = await runWithoutBun(
      parent,
      "create",
      "no-bun-app",
      "--yes",
      "--no-install",
      "--registry",
      `local:${join(repoRoot(), "registry")}`,
    );

    expect(stderr).toBe("");
    expect(code).toBe(0);
  });

  test("add writes the files and still prints what it did, then says the project needs Bun and exits non-zero", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bg-no-bun-add-"));
    dirs.push(parent);
    const project = await createProject({
      name: "no-bun-app",
      cwd: parent,
      git: false,
      install: false,
      registry: `local:${join(repoRoot(), "registry")}`,
    });

    const { stdout, stderr, code } = await runWithoutBun(
      project,
      "add",
      "ui/shadcn",
      "button",
      "--yes",
    );

    expect(code).toBe(1);
    expectOneLineAboutBun(stderr);
    expect(JSON.parse(stdout)).toMatchObject({
      dryRun: false,
      items: ["utils", "animations", "button"],
    });
    expect(existsSync(join(project, "packages/ui/package.json"))).toBe(true);
  });
});
