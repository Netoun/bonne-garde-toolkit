import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { templateBaseDir } from "./paths";

type BasePackage = {
  scripts: Record<string, string>;
  devDependencies: Record<string, string>;
};

async function basePackage(): Promise<BasePackage> {
  return JSON.parse(await readFile(join(templateBaseDir(), "package.json"), "utf8")) as BasePackage;
}

describe("the base template and the tooling module", () => {
  test("ships no vite.config.ts: tooling/vite-plus copies it, and an unrecorded file would collide", () => {
    expect(existsSync(join(templateBaseDir(), "vite.config.ts"))).toBe(false);
  });

  test("keeps the fmt, lint and check scripts of spec 010, which run on Vite+ defaults", async () => {
    const { scripts, devDependencies } = await basePackage();

    expect(scripts.fmt).toBe("vp fmt --write");
    expect(devDependencies["vite-plus"]).toBeDefined();
    // The empty base has no source file now that it ships no vite.config.ts, and `vp lint` exits 1
    // on "No files found to lint". A file with an error still fails: the flag only covers no file.
    expect(scripts.lint).toBe("vp lint --no-error-on-unmatched-pattern");
    expect(scripts.check).toBe("vp check --no-error-on-unmatched-pattern");
  });

  test("carries the husky prepare hook, so a hook file the module copies runs on a git project", async () => {
    const { scripts, devDependencies } = await basePackage();

    expect(scripts.prepare).toBe("husky");
    expect(devDependencies.husky).toMatch(/^\d+\.\d+\.\d+$/);
  });

  test("ships no hook of its own: .husky/pre-commit belongs to tooling/vite-plus", () => {
    expect(existsSync(join(templateBaseDir(), ".husky"))).toBe(false);
  });
});
