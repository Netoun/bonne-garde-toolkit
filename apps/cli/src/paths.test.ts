import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { defaultRegistrySource, findRepoRoot, packageRoot, templateBaseDir } from "./paths";

describe("paths", () => {
  test("resolves monorepo template and local registry", () => {
    const root = findRepoRoot();
    expect(root).not.toBeNull();
    expect(existsSync(join(root!, "registry/registry.json"))).toBe(true);
    expect(existsSync(join(templateBaseDir(), "package.json"))).toBe(true);
    expect(defaultRegistrySource().startsWith("local:")).toBe(true);
    expect(packageRoot().endsWith("cli") || packageRoot().includes("cli")).toBe(true);
  });
});
