import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addItems, listItems } from "./add";
import { createProject } from "./create";
import { findRepoRoot } from "./paths";

const dirs: string[] = [];

function repoRegistry(): string {
  const root = findRepoRoot();
  if (!root) {
    throw new Error("repo root not found");
  }
  return `local:${join(root, "registry")}`;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("bg create + add", () => {
  test("creates empty project and installs button with deps", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bg-cli-"));
    dirs.push(parent);

    const target = await createProject({
      name: "demo-app",
      cwd: parent,
      git: false,
      install: false,
      registry: repoRegistry(),
      scope: "@demo",
    });

    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      scope: string;
      platform: { version: string };
      installed: Record<string, unknown>;
    };
    expect(bg.scope).toBe("@demo");
    expect(bg.platform.version).toBe("0.1.0");
    expect(bg.installed).toEqual({});

    const listed = await listItems(target);
    expect(listed.some((i) => i.name === "button")).toBe(true);
    expect(listed.some((i) => i.name === "api-elysia")).toBe(true);

    const dry = await addItems({
      projectRoot: target,
      items: ["button"],
      dryRun: true,
      install: false,
    });
    expect(dry.plan.items.map((i) => i.name)).toEqual(["utils", "button"]);
    expect(dry.result.written.length).toBeGreaterThan(0);

    await addItems({
      projectRoot: target,
      items: ["button"],
      install: false,
    });

    const button = await readFile(join(target, "packages/ui/src/components/button.tsx"), "utf8");
    expect(button).toContain("export function Button");

    const after = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
      installed: Record<string, { source: string }>;
      capabilities: string[];
    };
    expect(after.installed.button).toBeDefined();
    expect(after.installed.utils).toBeDefined();
    expect(after.capabilities).toContain("ui");

    // idempotent re-add
    const again = await addItems({
      projectRoot: target,
      items: ["button"],
      install: false,
    });
    expect(again.result.written).toEqual([]);
    expect(again.result.skippedIdentical.length).toBeGreaterThan(0);
  });

  test("adds api-elysia shell", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bg-cli-api-"));
    dirs.push(parent);
    const target = await createProject({
      name: "api-demo",
      cwd: parent,
      git: false,
      install: false,
      registry: repoRegistry(),
    });

    await addItems({
      projectRoot: target,
      items: ["api-elysia"],
      install: false,
    });

    const app = await readFile(join(target, "apps/api/src/app.ts"), "utf8");
    expect(app).toContain("/health");
  });

  test("refuses non-empty target", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bg-cli-busy-"));
    dirs.push(parent);
    await mkdir(join(parent, "busy"));
    await writeFile(join(parent, "busy", "x.txt"), "x");
    await expect(
      createProject({
        name: "busy",
        cwd: parent,
        git: false,
        install: false,
      }),
    ).rejects.toThrow(/not empty/);
  });
});
