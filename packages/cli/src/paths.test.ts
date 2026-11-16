import { afterAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultRegistrySource,
  findRepoRoot,
  packageRoot,
  platformPackageVersion,
  templateBaseDir,
} from "./paths";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("paths", () => {
  test("resolves monorepo template and local registry", () => {
    const root = findRepoRoot();
    expect(root).not.toBeNull();
    expect(existsSync(join(root!, "registry/registry.json"))).toBe(true);
    expect(existsSync(join(templateBaseDir(), "package.json"))).toBe(true);
    expect(defaultRegistrySource().startsWith("local:")).toBe(true);
    expect(packageRoot().endsWith("cli") || packageRoot().includes("cli")).toBe(true);
  });

  test("the root of the packed package is the directory of the package.json named bonne-garde", async () => {
    const packed = await mkdtemp(join(tmpdir(), "bg-paths-"));
    dirs.push(packed);
    await mkdir(join(packed, "templates/base"), { recursive: true });
    await writeFile(join(packed, "package.json"), '{ "name": "bonne-garde", "version": "9.8.7" }');

    expect(packageRoot(packed)).toBe(packed);
    expect(platformPackageVersion(packed)).toBe("9.8.7");
  });
});
