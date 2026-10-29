import { afterEach, describe, expect, it } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixtures: string[] = [];

afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "boilerplate-init-"));
  fixtures.push(root);
  mkdirSync(join(root, "scripts"));
  copyFileSync(join(import.meta.dir, "init.ts"), join(root, "scripts/init.ts"));
  for (const [path, dependencies] of Object.entries({
    "apps/api": { "@fixture/emails": "workspace:*", "@fixture/config": "workspace:*" },
    "apps/spa": { "@fixture/ui": "workspace:*", "@fixture/config": "workspace:*" },
    "packages/emails": { "@fixture/config": "workspace:*" },
    "packages/config": {},
    "packages/ui": {},
  })) {
    mkdirSync(join(root, path), { recursive: true });
    writeFileSync(
      join(root, path, "package.json"),
      JSON.stringify({ name: `@fixture/${path.split("/").pop()}`, dependencies }),
    );
  }
  return root;
}

function runInit(root: string, ...args: string[]) {
  return Bun.spawnSync([process.execPath, "scripts/init.ts", "--yes", ...args], {
    cwd: root,
    stdout: "pipe",
    stderr: "pipe",
  });
}

describe("initialization", () => {
  it("keeps transitive workspace dependencies when selecting an app", () => {
    const root = createFixture();
    const result = runInit(root, "--keep=api", "--skip-brand", "--skip-env", "--skip-db");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, "packages/emails"))).toBe(true);
    expect(existsSync(join(root, "packages/config"))).toBe(true);
    expect(existsSync(join(root, "apps/spa"))).toBe(false);
    expect(existsSync(join(root, "packages/ui"))).toBe(false);
  });

  it("rejects removing a dependency of a kept app before deleting anything", () => {
    const root = createFixture();
    const result = runInit(root, "--remove=config", "--skip-brand", "--skip-env", "--skip-db");
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(join(root, "packages/config"))).toBe(true);
    expect(existsSync(join(root, ".acme-init.json"))).toBe(false);
  });

  it("rejects unknown module names before deleting anything", () => {
    const root = createFixture();
    const result = runInit(root, "--keep=typo", "--skip-brand", "--skip-env", "--skip-db");
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(join(root, "apps/api"))).toBe(true);
    expect(existsSync(join(root, "packages/config"))).toBe(true);
  });

  it("keeps dependencies used by root setup scripts even without an app", () => {
    const root = createFixture();
    writeFileSync(
      join(root, "package.json"),
      JSON.stringify({
        name: "fixture",
        devDependencies: { "@fixture/config": "workspace:*" },
      }),
    );
    const result = runInit(root, "--keep=ui", "--skip-brand", "--skip-env", "--skip-db");
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, "packages/config"))).toBe(true);
    expect(existsSync(join(root, "packages/ui"))).toBe(true);
    expect(existsSync(join(root, "apps/api"))).toBe(false);
  });

  it("rejects conflicting selection flags", () => {
    const root = createFixture();
    const result = runInit(
      root,
      "--keep=api",
      "--remove=spa",
      "--skip-brand",
      "--skip-env",
      "--skip-db",
    );
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(join(root, "apps/spa"))).toBe(true);
  });

  it("does not seed or mark setup done after failed migrations", () => {
    const root = createFixture();
    writeFileSync(
      join(root, "apps/api/package.json"),
      JSON.stringify({
        name: "@fixture/api",
        scripts: {
          "db:migrate:local": "bun -e 'process.exit(1)'",
          "db:seed": 'bun -e \'Bun.write("seed-ran", "yes")\'',
        },
      }),
    );
    const result = runInit(root, "--skip-brand", "--skip-env");
    expect(result.exitCode).not.toBe(0);
    expect(existsSync(join(root, "apps/api/seed-ran"))).toBe(false);
    expect(existsSync(join(root, ".acme-init.json"))).toBe(false);
    expect(result.stdout.toString()).not.toContain("Database ready");
  });

  it("leaves files and state untouched in dry-run mode", () => {
    const root = createFixture();
    const result = runInit(
      root,
      "--keep=api",
      "--dry-run",
      "--skip-brand",
      "--skip-env",
      "--skip-db",
    );
    expect(result.exitCode).toBe(0);
    expect(existsSync(join(root, "apps/spa"))).toBe(true);
    expect(existsSync(join(root, "packages/ui"))).toBe(true);
    expect(existsSync(join(root, ".acme-init.json"))).toBe(false);
  });
});
