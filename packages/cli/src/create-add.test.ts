import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectManifest } from "@bonne-garde/schema";
import { addItems, listItems } from "./add";
import { createProject } from "./create";
import { findRepoRoot, templateBaseDir } from "./paths";

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

    const bg = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as Record<
      string,
      unknown
    >;
    expect(bg.version).toBe(2);
    expect(bg.scope).toBe("@demo");
    expect(bg).toMatchObject({ platform: { version: "0.1.0" } });
    for (const field of ["modules", "items", "files", "regions"]) {
      expect(bg[field]).toEqual({});
    }
    expect(bg.apps).toEqual([]);
    expect(bg).not.toHaveProperty("installed");
    expect(bg).not.toHaveProperty("capabilities");

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
      version: number;
      items: Record<string, { source: string }>;
      modules: Record<string, unknown>;
    };
    expect(after.version).toBe(2);
    expect(after.items.button?.source).toBe("@bg/button");
    expect(after.items.utils?.source).toBe("@bg/utils");
    expect(after.modules).toEqual({});
    expect(after).not.toHaveProperty("installed");
    expect(after).not.toHaveProperty("capabilities");

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

  test("creates the spec 010 scratch root and check tooling", async () => {
    const parent = await mkdtemp(join(tmpdir(), "bg-cli-base-"));
    dirs.push(parent);
    const target = await createProject({
      name: "base-demo",
      cwd: parent,
      git: false,
      install: false,
      registry: repoRegistry(),
    });

    const gitignore = (await readFile(join(target, ".gitignore"), "utf8")).split("\n");
    expect(gitignore).toContain(".bg/");
    expect(gitignore).not.toContain("bg.upgrade/");
    expect(gitignore).not.toContain(".acme-init.json");

    const pkg = JSON.parse(await readFile(join(target, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    for (const script of ["fmt", "lint", "check"]) {
      expect(pkg.scripts[script]).toStartWith("vp ");
    }

    // Spec 010: typecheck and test succeed on the empty workspace.
    for (const script of ["typecheck", "test"]) {
      const proc = Bun.spawn(["bun", "run", script], {
        cwd: target,
        stdout: "ignore",
        stderr: "pipe",
      });
      expect(await proc.exited).toBe(0);
    }
  });

  test("the packaged template carries a v2 bg.json", async () => {
    const template = JSON.parse(await readFile(join(templateBaseDir(), "bg.json"), "utf8")) as {
      version: number;
    };
    expect(template.version).toBe(2);
    const { manifest, migratedFrom } = readProjectManifest(template);
    expect(migratedFrom).toBeNull();
    expect(manifest).toMatchObject({ apps: [], modules: {}, items: {}, files: {}, regions: {} });
  });

  describe("a v1 bg.json", () => {
    const V1 = {
      version: 1,
      scope: "@legacy",
      platform: {
        version: "0.1.0",
        remote: "github:Netoun/bonne-garde-toolkit",
        intentions: { applied: [], skipped: {} },
      },
      installed: {
        card: { source: "@bg/card", version: "0.1.0", installedAt: "2026-01-01T00:00:00.000Z" },
      },
      capabilities: ["ui"],
    };

    async function v1Project(prefix: string): Promise<string> {
      const parent = await mkdtemp(join(tmpdir(), prefix));
      dirs.push(parent);
      const target = await createProject({
        name: "legacy-app",
        cwd: parent,
        git: false,
        install: false,
        registry: repoRegistry(),
      });
      await writeFile(
        join(target, "bg.json"),
        `${JSON.stringify({ ...V1, registries: { "@bg": repoRegistry() } }, null, 2)}\n`,
      );
      return target;
    }

    test("stays readable, and is rewritten as v2 by the next add", async () => {
      const target = await v1Project("bg-cli-v1-");

      expect((await listItems(target)).some((i) => i.name === "button")).toBe(true);

      const { migratedFrom } = await addItems({
        projectRoot: target,
        items: ["button"],
        install: false,
      });
      expect(migratedFrom).toBe(1);

      const after = JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as {
        version: number;
        items: Record<string, unknown>;
        files: unknown;
        regions: unknown;
      };
      expect(after.version).toBe(2);
      // the v1 record survives under `items`, beside what this add wrote
      expect(Object.keys(after.items).sort()).toEqual(["button", "card", "utils"]);
      // pre-v2 files are user-owned: nothing is claimed for them
      expect(after.files).toEqual({});
      expect(after.regions).toEqual({});
      expect(after).not.toHaveProperty("installed");
      expect(after).not.toHaveProperty("capabilities");
    });

    test("is not rewritten by a dry run", async () => {
      const target = await v1Project("bg-cli-v1-dry-");
      const before = await readFile(join(target, "bg.json"), "utf8");
      const { migratedFrom } = await addItems({
        projectRoot: target,
        items: ["button"],
        dryRun: true,
        install: false,
      });
      expect(migratedFrom).toBe(1);
      expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
    });

    async function runAdd(target: string, ...args: string[]) {
      const bin = join(findRepoRoot() ?? "", "packages/cli/src/bin.ts");
      const proc = Bun.spawn(["bun", bin, "add", "button", "--no-install", ...args], {
        cwd: target,
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

    test("the CLI says it rewrote the file, without touching stdout's JSON", async () => {
      const target = await v1Project("bg-cli-v1-say-");
      const { stdout, stderr, code } = await runAdd(target);
      expect(code).toBe(0);
      expect(stderr).toContain("rewrote bg.json from version 1 to version 2");
      expect(stderr).toContain("user-owned");
      expect(JSON.parse(stdout)).toMatchObject({ dryRun: false });
    });

    test("the CLI says a dry run would rewrite it, and does not", async () => {
      const target = await v1Project("bg-cli-v1-say-dry-");
      const before = await readFile(join(target, "bg.json"), "utf8");
      const { stderr, code } = await runAdd(target, "--dry-run");
      expect(code).toBe(0);
      expect(stderr).toContain("bg.json is version 1");
      expect(stderr).toContain("--dry-run");
      expect(await readFile(join(target, "bg.json"), "utf8")).toBe(before);
    });
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
