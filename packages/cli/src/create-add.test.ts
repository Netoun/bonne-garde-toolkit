import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
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

  describe("add records what it wrote", () => {
    function sha256Hex(bytes: string | Uint8Array): string {
      return createHash("sha256").update(bytes).digest("hex");
    }

    async function freshProject(prefix: string): Promise<string> {
      const parent = await mkdtemp(join(tmpdir(), prefix));
      dirs.push(parent);
      return createProject({
        name: "rec-app",
        cwd: parent,
        git: false,
        install: false,
        registry: repoRegistry(),
        scope: "@rec",
      });
    }

    /** Every file under `root` -> sha256 of its bytes, `bg.json` included. */
    async function snapshot(root: string): Promise<Record<string, string>> {
      const out: Record<string, string> = {};
      for (const entry of await readdir(root, { recursive: true })) {
        const abs = join(root, entry);
        if ((await stat(abs)).isFile()) {
          out[entry] = sha256Hex(await readFile(abs));
        }
      }
      return out;
    }

    /** `installedAt` is the one field a re-add may move. */
    function withoutInstalledAt(json: string): string {
      return json.replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"');
    }

    test("`files` has one entry per written file, and each sha256 is the file's", async () => {
      const target = await freshProject("bg-cli-rec-");
      const { result } = await addItems({ projectRoot: target, items: ["button"], install: false });

      const { manifest } = readProjectManifest(
        JSON.parse(await readFile(join(target, "bg.json"), "utf8")) as unknown,
      );
      expect(result.written.length).toBeGreaterThan(1);
      expect(Object.keys(manifest.files).sort()).toEqual([...result.written].sort());
      for (const [path, record] of Object.entries(manifest.files)) {
        expect(record.sha256).toBe(sha256Hex(await readFile(join(target, path))));
      }
      expect(manifest.files["packages/ui/src/components/button.tsx"]?.owner).toBe("button");
      expect(manifest.files["packages/ui/src/lib/utils.ts"]?.owner).toBe("utils");
      // The engine applies no patch yet, so there is nothing to record under `regions`.
      expect(manifest.regions).toEqual({});
    });

    test("a second add skips every file and changes nothing but installedAt", async () => {
      const target = await freshProject("bg-cli-rec-twice-");
      const first = await addItems({ projectRoot: target, items: ["button"], install: false });
      const firstJson = await readFile(join(target, "bg.json"), "utf8");
      const firstTree = await snapshot(target);

      const second = await addItems({ projectRoot: target, items: ["button"], install: false });

      expect(second.result.written).toEqual([]);
      // `utils` is already installed, so the plan is `button` alone; its one file is skipped ...
      expect(second.plan.items.map((i) => i.name)).toEqual(["button"]);
      expect(second.result.skippedIdentical).toEqual(["packages/ui/src/components/button.tsx"]);
      // ... and the records of everything the first add wrote survive
      expect(Object.keys(first.result.manifest.files)).toHaveLength(4);
      expect(second.result.manifest.files).toEqual(first.result.manifest.files);
      const secondJson = await readFile(join(target, "bg.json"), "utf8");
      expect(withoutInstalledAt(secondJson)).toBe(withoutInstalledAt(firstJson));
      const { "bg.json": _bg, ...secondTree } = await snapshot(target);
      const { "bg.json": _firstBg, ...firstFiles } = firstTree;
      expect(secondTree).toEqual(firstFiles);
    });

    test("--dry-run leaves the tree and bg.json byte-identical", async () => {
      const target = await freshProject("bg-cli-rec-dry-");
      const before = await snapshot(target);

      const { result } = await addItems({
        projectRoot: target,
        items: ["button"],
        dryRun: true,
        install: false,
      });

      expect(result.written.length).toBeGreaterThan(0);
      expect(Object.keys(result.manifest.files).sort()).toEqual([...result.written].sort());
      expect(await snapshot(target)).toEqual(before);
    });
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
        files: Record<string, { owner: string; sha256: string }>;
        regions: unknown;
      };
      expect(after.version).toBe(2);
      // the v1 record survives under `items`, beside what this add wrote
      expect(Object.keys(after.items).sort()).toEqual(["button", "card", "utils"]);
      // pre-v2 files are user-owned: only what this add wrote is claimed, never what card wrote
      expect(Object.values(after.files).map((f) => f.owner)).toEqual(
        expect.arrayContaining(["button", "utils"]),
      );
      expect(Object.values(after.files).every((f) => f.owner !== "card")).toBe(true);
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
