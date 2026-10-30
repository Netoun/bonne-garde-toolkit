import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  createEmptyProjectManifest,
  parseProjectManifest,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { applyInstallPlan } from "./apply-plan";
import type { ModulePlan } from "./module-plan";
import type { PlannedPatch } from "./patch-plan";
import { sha256Hex } from "./sha256";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = () => "2026-02-02T00:00:00.000Z";
const NO_ITEMS = { items: [], npmDependencies: [], npmDevDependencies: [] };

const ROOT_PACKAGE = `{
  "name": "demo",
  "scripts": {
    "dev": "bun run dev"
  }
}
`;
const GEN = "bun packages/config/scripts/gen-branding.ts";
const REGION = "scripts.gen:branding";

function patch(scripts: Record<string, string> = { "gen:branding": GEN }, file = "package.json") {
  return { type: "scripts.merge", file, scripts } satisfies PlannedPatch;
}

function modulePlan(overrides: Partial<ModulePlan> = {}): ModulePlan {
  return {
    category: "config",
    id: "branding",
    key: "config/branding",
    variant: "default",
    options: {},
    files: [],
    patches: [patch()],
    env: [],
    dependencies: {},
    devDependencies: {},
    workspace: null,
    checks: [],
    ...overrides,
  };
}

async function freshProject(
  files: Record<string, string> = { "package.json": ROOT_PACKAGE },
): Promise<{ projectRoot: string; manifest: ProjectManifest }> {
  const parent = await mkdtemp(join(tmpdir(), "bg-applypatch-"));
  dirs.push(parent);
  const projectRoot = join(parent, "project");
  await mkdir(projectRoot);
  for (const [path, content] of Object.entries(files)) {
    await mkdir(join(projectRoot, path, ".."), { recursive: true });
    await writeFile(join(projectRoot, path), content);
  }
  return {
    projectRoot,
    manifest: createEmptyProjectManifest({
      scope: "@demo",
      registries: {},
      platformVersion: "0.3.0",
    }),
  };
}

async function snapshot(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(path);
      } else {
        out[relative(root, path)] = await readFile(path, "utf8");
      }
    }
  };
  await walk(root);
  return out;
}

async function install(
  projectRoot: string,
  manifest: ProjectManifest,
  modules: ModulePlan[],
  extra: { force?: boolean; dryRun?: boolean } = {},
) {
  return applyInstallPlan({
    projectRoot,
    manifest,
    plan: NO_ITEMS,
    modules,
    sourceLabel: "@bg",
    now: NOW,
    ...extra,
  });
}

const read = (root: string, path: string) => readFile(join(root, path), "utf8");

describe("applyInstallPlan: scripts.merge (060)", () => {
  test("adds the script without reformatting the file, and records the region and the outcome", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [modulePlan()]);

    expect(await read(projectRoot, "package.json")).toBe(
      ROOT_PACKAGE.replace(
        '    "dev": "bun run dev"\n',
        `    "dev": "bun run dev",\n    "gen:branding": "${GEN}"\n`,
      ),
    );
    expect(result.manifest.regions).toEqual({ "package.json": { [REGION]: "config/branding" } });
    expect(result.manifest.modules.config?.[0]?.patches).toEqual([
      { type: "scripts.merge", file: "package.json", status: "applied" },
    ]);
    expect(result.patches).toEqual([
      {
        module: "config/branding",
        type: "scripts.merge",
        file: "package.json",
        status: "applied",
        regions: [{ region: REGION, status: "applied" }],
      },
    ]);
    // The file belongs to the project, not to the module: no sha256 is recorded for it.
    expect(result.manifest.files).toEqual({});
    expect(result.written).toEqual([]);
  });

  test("re-applying finds the region present and equal: skipped, and the tree is the same bytes", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [modulePlan()]);
    const tree = await snapshot(projectRoot);

    const second = await install(projectRoot, first.manifest, [modulePlan()]);

    expect(second.patches).toEqual([
      {
        module: "config/branding",
        type: "scripts.merge",
        file: "package.json",
        status: "skipped",
        regions: [{ region: REGION, status: "skipped" }],
      },
    ]);
    expect(second.manifest.regions).toEqual(first.manifest.regions);
    // The run reports `skipped`; the record keeps describing the state: the patch is in place.
    expect(second.manifest.modules.config?.[0]?.patches).toEqual([
      { type: "scripts.merge", file: "package.json", status: "applied" },
    ]);
    expect(second.manifest.modules).toEqual(first.manifest.modules);
    const { "bg.json": _bg, ...files } = await snapshot(projectRoot);
    const { "bg.json": _firstBg, ...firstFiles } = tree;
    expect(files).toEqual(firstFiles);
  });

  test("a patch that was skipped at the first add stays skipped, and one that failed becomes skipped once it is in place", async () => {
    const equal = `{ "scripts": { "gen:branding": "${GEN}" } }\n`;
    const { projectRoot, manifest } = await freshProject({ "package.json": equal });
    const first = await install(projectRoot, manifest, [modulePlan()]);
    expect(first.manifest.modules.config?.[0]?.patches[0]?.status).toBe("skipped");
    expect(
      (await install(projectRoot, first.manifest, [modulePlan()])).manifest.modules.config?.[0]
        ?.patches[0]?.status,
    ).toBe("skipped");

    const failed = await freshProject({});
    const broken = await install(failed.projectRoot, failed.manifest, [modulePlan()]);
    await writeFile(join(failed.projectRoot, "package.json"), equal);
    const fixed = await install(failed.projectRoot, broken.manifest, [modulePlan()]);
    expect(broken.manifest.modules.config?.[0]?.patches[0]?.status).toBe("failed");
    expect(fixed.manifest.modules.config?.[0]?.patches[0]?.status).toBe("skipped");
  });

  test("a script the project already has, equal to the declared one, is skipped and adopted", async () => {
    const { projectRoot, manifest } = await freshProject({
      "package.json": `{ "scripts": { "gen:branding": "${GEN}" } }\n`,
    });
    const before = await snapshot(projectRoot);

    const result = await install(projectRoot, manifest, [modulePlan()]);

    expect(result.patches[0]?.status).toBe("skipped");
    expect(result.manifest.regions).toEqual({ "package.json": { [REGION]: "config/branding" } });
    expect(await read(projectRoot, "package.json")).toBe(before["package.json"] ?? "");
  });

  test("a script that differs from the declared one fails the install, listing it, and --force overwrites it", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [modulePlan()]);
    const edited = (await read(projectRoot, "package.json")).replace(GEN, "bun my-own-script.ts");
    await writeFile(join(projectRoot, "package.json"), edited);
    const before = await snapshot(projectRoot);

    await expect(install(projectRoot, first.manifest, [modulePlan()])).rejects.toThrow(
      /nothing was written.*in the way \(use --force to overwrite\):\n {2}scripts\.gen:branding of package\.json is "bun my-own-script\.ts", which differs from what config\/branding declares/s,
    );
    expect(await snapshot(projectRoot)).toEqual(before);

    const forced = await install(projectRoot, first.manifest, [modulePlan()], { force: true });

    expect(await read(projectRoot, "package.json")).toBe(
      edited.replace("bun my-own-script.ts", GEN),
    );
    expect(forced.patches[0]).toMatchObject({
      status: "applied",
      regions: [{ region: REGION, status: "applied", replaced: "bun my-own-script.ts" }],
    });
  });

  describe("a file the module writes and then patches (the api module's package.json)", () => {
    const FILE = "apps/api/package.json";
    const VENDORED = `${JSON.stringify({ name: "@demo/api", scripts: { test: "bun test" } }, null, 2)}\n`;
    const DEV = "wrangler dev --port 5172";
    const vendoring = () =>
      modulePlan({
        category: "api",
        id: "elysia",
        key: "api/elysia",
        files: [{ target: FILE, content: VENDORED }],
        patches: [patch({ dev: DEV }, FILE)],
      });

    test("a hand-edited region is named as the region, not as a modified file, and --force reports what it replaced", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [vendoring()]);
      const clean = await read(projectRoot, FILE);
      expect(JSON.parse(clean)).toEqual({
        name: "@demo/api",
        scripts: { test: "bun test", dev: DEV },
      });
      await writeFile(join(projectRoot, FILE), clean.replace(DEV, "bun my-own-dev.ts"));
      const before = await snapshot(projectRoot);

      await expect(install(projectRoot, first.manifest, [vendoring()])).rejects.toThrow(
        /nothing was written.*in the way \(use --force to overwrite\):\n {2}scripts\.dev of apps\/api\/package\.json is "bun my-own-dev\.ts", which differs from what api\/elysia declares \("wrangler dev --port 5172"\)/s,
      );
      expect(await snapshot(projectRoot)).toEqual(before);

      const forced = await install(projectRoot, first.manifest, [vendoring()], { force: true });

      expect(await read(projectRoot, FILE)).toBe(clean);
      expect(forced.patches[0]?.regions).toEqual([
        { region: "scripts.dev", status: "applied", replaced: "bun my-own-dev.ts" },
      ]);
    });

    test("an edit anywhere else in the file is a modified file, whether or not a region was edited too", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [vendoring()]);
      const clean = await read(projectRoot, FILE);

      for (const edited of [
        clean.replace('"name": "@demo/api"', '"name": "@demo/api", "license": "MIT"'),
        clean
          .replace('"name": "@demo/api"', '"name": "@demo/api", "license": "MIT"')
          .replace(DEV, "bun my-own-dev.ts"),
      ]) {
        await writeFile(join(projectRoot, FILE), edited);

        await expect(install(projectRoot, first.manifest, [vendoring()])).rejects.toThrow(
          /apps\/api\/package\.json was modified since api\/elysia wrote it/,
        );
        expect(await read(projectRoot, FILE)).toBe(edited);
      }
    });

    test("the same install again reports the patch skipped and writes nothing", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [vendoring()]);
      const before = await snapshot(projectRoot);

      const again = await install(projectRoot, first.manifest, [vendoring()]);

      expect(again.patches[0]).toMatchObject({
        status: "skipped",
        regions: [{ region: "scripts.dev", status: "skipped" }],
      });
      expect(await snapshot(projectRoot)).toEqual(before);
    });
  });

  test("a script the project wrote itself, with no region recorded, is user-owned: the same refusal", async () => {
    const { projectRoot, manifest } = await freshProject({
      "package.json": '{ "scripts": { "gen:branding": "echo mine" } }\n',
    });

    await expect(install(projectRoot, manifest, [modulePlan()])).rejects.toThrow(
      /scripts\.gen:branding of package\.json is "echo mine"/,
    );
  });

  test("a region owned by another module fails, and --force does not bypass it", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await install(projectRoot, manifest, [
      modulePlan({ category: "dev", id: "other", key: "dev/other" }),
    ]);
    const before = await snapshot(projectRoot);

    for (const force of [false, true]) {
      await expect(install(projectRoot, first.manifest, [modulePlan()], { force })).rejects.toThrow(
        /nothing was written; --force does not change this:\n {2}scripts\.gen:branding of package\.json is owned by dev\/other, and config\/branding would write it/,
      );
    }
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("two modules writing one script in the same call fail, whoever comes first", async () => {
    const { projectRoot, manifest } = await freshProject();
    const before = await snapshot(projectRoot);

    await expect(
      install(projectRoot, manifest, [
        modulePlan(),
        modulePlan({ category: "dev", id: "other", key: "dev/other" }),
      ]),
    ).rejects.toThrow(
      /scripts\.gen:branding of package\.json is named by both config\/branding and dev\/other/,
    );
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("two patches on one file compose, in one write", async () => {
    const { projectRoot, manifest } = await freshProject();

    const result = await install(projectRoot, manifest, [
      modulePlan({ patches: [patch({ one: "1" }), patch({ two: "2", three: "3" })] }),
    ]);

    expect(JSON.parse(await read(projectRoot, "package.json"))).toMatchObject({
      scripts: { dev: "bun run dev", one: "1", two: "2", three: "3" },
    });
    expect(result.manifest.regions["package.json"]).toEqual({
      "scripts.one": "config/branding",
      "scripts.two": "config/branding",
      "scripts.three": "config/branding",
    });
  });

  describe("a patch that cannot apply is `failed`, recorded, and never aborts the install", () => {
    const stat = (result: Awaited<ReturnType<typeof install>>) => result.patches[0];

    test("a target file that does not exist", async () => {
      const { projectRoot, manifest } = await freshProject({});

      const result = await install(projectRoot, manifest, [
        modulePlan({ files: [{ target: "packages/config/index.ts", content: "export {};\n" }] }),
      ]);

      expect(stat(result)).toEqual({
        module: "config/branding",
        type: "scripts.merge",
        file: "package.json",
        status: "failed",
        reason: "package.json does not exist",
        regions: [],
      });
      // The tier-1 file is installed, the module is recorded, and no region is claimed.
      expect(await read(projectRoot, "packages/config/index.ts")).toBe("export {};\n");
      expect(result.manifest.modules.config?.[0]?.patches).toEqual([
        {
          type: "scripts.merge",
          file: "package.json",
          status: "failed",
          reason: "package.json does not exist",
        },
      ]);
      expect(result.manifest.regions).toEqual({});
    });

    test("a target that is not JSON, and one whose scripts is not an object", async () => {
      for (const [text, reason] of [
        ['{\n  "scripts": {\n    "a": \n}\n', /^package\.json: not valid JSON \(.* at line 4\)$/],
        ['{ "scripts": [] }\n', /^package\.json: "scripts" is an array, not an object$/],
      ] as const) {
        const { projectRoot, manifest } = await freshProject({ "package.json": text });

        const result = await install(projectRoot, manifest, [modulePlan()]);

        expect(stat(result)?.status).toBe("failed");
        expect(stat(result)?.reason).toMatch(reason);
        expect(await read(projectRoot, "package.json")).toBe(text);
      }
    });

    test("a failed patch is replaced by the outcome of the next add that works", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const failed = await install(projectRoot, manifest, [modulePlan()]);
      await writeFile(join(projectRoot, "package.json"), ROOT_PACKAGE);

      const fixed = await install(projectRoot, failed.manifest, [modulePlan()]);

      expect(fixed.manifest.modules.config?.[0]?.patches).toEqual([
        { type: "scripts.merge", file: "package.json", status: "applied" },
      ]);
    });
  });

  test("--dry-run computes the patch, reports it and writes nothing", async () => {
    const { projectRoot, manifest } = await freshProject();
    await writeFile(join(projectRoot, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await snapshot(projectRoot);

    const result = await install(projectRoot, manifest, [modulePlan()], { dryRun: true });

    expect(result.patches[0]).toMatchObject({ status: "applied" });
    expect(result.manifest.regions).toEqual({ "package.json": { [REGION]: "config/branding" } });
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("a write error elsewhere in the call puts the patched file back", async () => {
    const { projectRoot, manifest } = await freshProject({
      "package.json": ROOT_PACKAGE,
      blocker: "a file in the way",
    });
    const before = await snapshot(projectRoot);

    await expect(
      install(projectRoot, manifest, [
        modulePlan({ files: [{ target: "blocker/last.json", content: "{}" }] }),
      ]),
    ).rejects.toThrow();

    expect(await snapshot(projectRoot)).toEqual(before);
  });

  describe("a file the same call writes (tier 1) and patches", () => {
    const vendored = `{\n  "name": "@demo/api",\n  "scripts": {\n    "test": "bun test"\n  }\n}\n`;
    const plan = () =>
      modulePlan({
        category: "api",
        id: "elysia",
        key: "api/elysia",
        files: [{ target: "apps/api/package.json", content: vendored }],
        patches: [patch({ dev: "wrangler dev" }, "apps/api/package.json")],
      });

    test("is written once, patched, with the sha256 of what landed", async () => {
      const { projectRoot, manifest } = await freshProject({});

      const result = await install(projectRoot, manifest, [plan()]);

      const landed = await read(projectRoot, "apps/api/package.json");
      expect(JSON.parse(landed)).toMatchObject({
        scripts: { test: "bun test", dev: "wrangler dev" },
      });
      expect(result.manifest.files["apps/api/package.json"]).toEqual({
        owner: "api/elysia",
        sha256: sha256Hex(landed),
      });
      expect(result.manifest.regions["apps/api/package.json"]).toEqual({
        "scripts.dev": "api/elysia",
      });
      expect(result.written).toEqual(["apps/api/package.json"]);
    });

    test("re-adding it skips the file and the patch, and the tree is the same bytes", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [plan()]);
      const tree = await snapshot(projectRoot);

      const second = await install(projectRoot, first.manifest, [plan()]);

      expect(second.written).toEqual([]);
      expect(second.skippedIdentical).toEqual(["apps/api/package.json"]);
      expect(second.patches[0]?.status).toBe("skipped");
      expect(second.manifest.files).toEqual(first.manifest.files);
      const { "bg.json": _bg, ...files } = await snapshot(projectRoot);
      const { "bg.json": _firstBg, ...firstFiles } = tree;
      expect(files).toEqual(firstFiles);
    });

    test("a region of another module in that file makes a re-write refuse, --force or not", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [plan()]);
      const other = await install(projectRoot, first.manifest, [
        modulePlan({
          category: "dev",
          id: "other",
          key: "dev/other",
          patches: [patch({ lint: "vp lint" }, "apps/api/package.json")],
        }),
      ]);
      const before = await snapshot(projectRoot);

      for (const force of [false, true]) {
        await expect(install(projectRoot, other.manifest, [plan()], { force })).rejects.toThrow(
          /apps\/api\/package\.json carries scripts\.lint, owned by dev\/other; writing api\/elysia's version would drop it/,
        );
      }
      expect(await snapshot(projectRoot)).toEqual(before);
    });
  });
});

describe("a module record keeps only what 020 names", () => {
  test("patches carry type, file, status and a reason when failed, no per-region detail", async () => {
    const { projectRoot, manifest } = await freshProject();

    const { manifest: next } = await install(projectRoot, manifest, [modulePlan()]);

    expect(parseProjectManifest(next)).toEqual(next);
    expect(Object.keys(next.modules.config?.[0]?.patches[0] ?? {}).sort()).toEqual([
      "file",
      "status",
      "type",
    ]);
  });
});
