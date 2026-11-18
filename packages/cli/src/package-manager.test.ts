import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installDependencies, invokingPackageManager, packageManagerOf } from "./package-manager";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** A project root whose package.json is `manifest`. */
async function project(manifest: Record<string, unknown>): Promise<string> {
  const dir = await realpath(await mkdtemp(join(tmpdir(), "bg-pm-")));
  dirs.push(dir);
  await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
  return dir;
}

describe("packageManagerOf", () => {
  test("is the package manager the root package.json pins", async () => {
    expect(await packageManagerOf(await project({ packageManager: "bun@1.4.2" }))).toBe("bun");
    expect(await packageManagerOf(await project({ packageManager: "pnpm@12.17.0" }))).toBe("pnpm");
  });

  test("refuses a project that pins none, or one bg cannot install with, naming the pm modules", async () => {
    await expect(packageManagerOf(await project({ name: "x" }))).rejects.toThrow(
      /pins no package manager.*pm\/bun or pm\/pnpm/,
    );
    await expect(packageManagerOf(await project({ packageManager: "yarn@4.0.0" }))).rejects.toThrow(
      /yarn@4\.0\.0/,
    );
  });
});

describe("installDependencies", () => {
  test("says which package manager is missing, instead of a spawn error", async () => {
    const root = await project({ packageManager: "pnpm@12.17.0" });

    expect(await installDependencies(root, { env: { PATH: "/nonexistent" } })).toEqual({
      pm: "pnpm",
      missing: true,
    });
  });
});

describe("invokingPackageManager", () => {
  test("is the package manager `create` was started from, when a project can use it", () => {
    expect(invokingPackageManager({ npm_config_user_agent: "pnpm/12.17.0 npm/? node/v24" })).toBe(
      "pnpm",
    );
    expect(invokingPackageManager({ npm_config_user_agent: "bun/1.4.2 npm/? node/v24" })).toBe(
      "bun",
    );
  });

  test("is none for npm, yarn, or no user agent", () => {
    expect(invokingPackageManager({ npm_config_user_agent: "npm/11.0.0 node/v24" })).toBeNull();
    expect(invokingPackageManager({ npm_config_user_agent: "yarn/4.0.0" })).toBeNull();
    expect(invokingPackageManager({})).toBeNull();
  });
});
