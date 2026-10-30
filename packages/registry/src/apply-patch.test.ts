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

    test("an edit outside every region is not a conflict: the file is kept, --force or not", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [vendoring()]);
      const edited = (await read(projectRoot, FILE)).replace(
        '"name": "@demo/api"',
        '"name": "@demo/api", "license": "MIT"',
      );
      await writeFile(join(projectRoot, FILE), edited);
      const before = await snapshot(projectRoot);

      for (const force of [false, true]) {
        const again = await install(projectRoot, first.manifest, [vendoring()], { force });

        expect(again.kept).toEqual([FILE]);
        expect(again.written).toEqual([]);
        expect(again.skippedIdentical).toEqual([]);
        expect(again.patches[0]).toMatchObject({
          status: "skipped",
          regions: [{ region: "scripts.dev", status: "skipped" }],
        });
        expect(again.manifest.files).toEqual(first.manifest.files);
        expect(await snapshot(projectRoot)).toEqual(before);
      }
    });

    test("an edit of a region is the conflict, named as the region, whatever else was edited", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [vendoring()]);
      const edited = (await read(projectRoot, FILE))
        .replace('"name": "@demo/api"', '"name": "@demo/api", "license": "MIT"')
        .replace(DEV, "bun my-own-dev.ts");
      await writeFile(join(projectRoot, FILE), edited);

      const failure = await install(projectRoot, first.manifest, [vendoring()]).then(
        () => "",
        (error: Error) => error.message,
      );

      expect(failure).toMatch(/scripts\.dev of apps\/api\/package\.json is "bun my-own-dev\.ts"/);
      expect(failure).not.toMatch(/modified since/);
      expect(await read(projectRoot, FILE)).toBe(edited);

      await install(projectRoot, first.manifest, [vendoring()], { force: true });

      // --force overwrites the region and nothing else: the project's own edit is still there.
      expect(await read(projectRoot, FILE)).toBe(edited.replace("bun my-own-dev.ts", DEV));
    });

    test("a patch of another module is applied to the file as the project has it", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [vendoring()]);
      const edited = (await read(projectRoot, FILE)).replace(
        '"name": "@demo/api"',
        '"name": "@demo/api", "license": "MIT"',
      );
      await writeFile(join(projectRoot, FILE), edited);

      const other = await install(projectRoot, first.manifest, [
        modulePlan({
          category: "dev",
          id: "other",
          key: "dev/other",
          patches: [patch({ lint: "vp lint" }, FILE)],
        }),
      ]);

      expect(JSON.parse(await read(projectRoot, FILE))).toEqual({
        name: "@demo/api",
        license: "MIT",
        scripts: { test: "bun test", dev: DEV, lint: "vp lint" },
      });
      expect(other.manifest.regions[FILE]).toEqual({
        "scripts.dev": "api/elysia",
        "scripts.lint": "dev/other",
      });
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
        intention: "config/branding/patch-scripts-merge-package-json-scripts-gen-branding",
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
          intention: "config/branding/patch-scripts-merge-package-json-scripts-gen-branding",
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

    test("is written once, patched, with the sha256 of what the module wrote and not of what the patch made of it", async () => {
      const { projectRoot, manifest } = await freshProject({});

      const result = await install(projectRoot, manifest, [plan()]);

      const landed = await read(projectRoot, "apps/api/package.json");
      expect(JSON.parse(landed)).toMatchObject({
        scripts: { test: "bun test", dev: "wrangler dev" },
      });
      expect(result.manifest.files["apps/api/package.json"]).toEqual({
        owner: "api/elysia",
        sha256: sha256Hex(vendored),
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

    test("a region of another module in that file keeps the owner's re-add from rewriting it, and makes any other writer refuse, --force or not", async () => {
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

      // The tier-1 owner asks again: the file is the project's now, and dev/other's script is in it.
      for (const force of [false, true]) {
        const again = await install(projectRoot, other.manifest, [plan()], { force });
        expect(again.kept.concat(again.skippedIdentical)).toEqual(["apps/api/package.json"]);
        expect(again.written).toEqual([]);
      }
      expect(await snapshot(projectRoot)).toEqual(before);

      // Another module writing the whole file would drop dev/other's region: refused.
      const intruder = () =>
        modulePlan({
          category: "dev",
          id: "intruder",
          key: "dev/intruder",
          files: [{ target: "apps/api/package.json", content: vendored }],
          patches: [],
        });
      for (const force of [false, true]) {
        await expect(install(projectRoot, other.manifest, [intruder()], { force })).rejects.toThrow(
          /apps\/api\/package\.json carries scripts\.dev, scripts\.lint, owned by api\/elysia, dev\/other; writing dev\/intruder's version would drop them/,
        );
      }
      expect(await snapshot(projectRoot)).toEqual(before);
    });
  });
});

describe("applyInstallPlan: jsonc.merge (060)", () => {
  const WRANGLER = `{
  // the worker
  "name": "my-app-api",
  "vars": {
    "API_URL": "http://localhost:5172",
  },
}
`;
  const FILE = "apps/api/wrangler.jsonc";
  const D1 = [{ binding: "DB", database_name: "my-app", database_id: "local" }];
  const merge = (value: Record<string, unknown>, file = FILE) =>
    ({ type: "jsonc.merge", file, value }) satisfies PlannedPatch;
  const dbModule = (patches: PlannedPatch[] = [merge({ d1_databases: D1 })]) =>
    modulePlan({ category: "db", id: "d1", key: "db/d1", patches });
  const project = () => freshProject({ [FILE]: WRANGLER, "package.json": ROOT_PACKAGE });

  test("merges the value, one region per leaf and an array whole, and records them", async () => {
    const { projectRoot, manifest } = await project();

    const result = await install(projectRoot, manifest, [
      dbModule([merge({ d1_databases: D1, vars: { SPA_URL: "http://localhost:5173" } })]),
    ]);

    expect(await read(projectRoot, FILE)).toBe(`{
  // the worker
  "name": "my-app-api",
  "vars": {
    "API_URL": "http://localhost:5172",
    "SPA_URL": "http://localhost:5173",
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "my-app",
      "database_id": "local",
    },
  ],
}
`);
    expect(result.patches).toEqual([
      {
        module: "db/d1",
        type: "jsonc.merge",
        file: FILE,
        status: "applied",
        regions: [
          { region: "d1_databases", status: "applied" },
          { region: "vars.SPA_URL", status: "applied" },
        ],
      },
    ]);
    expect(result.manifest.regions).toEqual({
      [FILE]: { d1_databases: "db/d1", "vars.SPA_URL": "db/d1" },
    });
    expect(result.manifest.modules.db?.[0]?.patches).toEqual([
      { type: "jsonc.merge", file: FILE, status: "applied" },
    ]);
    // The file belongs to the project, not to the module.
    expect(result.manifest.files).toEqual({});
  });

  test("the same install again skips every region, and the tree is the same bytes", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [dbModule()]);
    const tree = await snapshot(projectRoot);

    const second = await install(projectRoot, first.manifest, [dbModule()]);

    expect(second.patches[0]).toMatchObject({
      status: "skipped",
      regions: [{ region: "d1_databases", status: "skipped" }],
    });
    expect(second.manifest.regions).toEqual(first.manifest.regions);
    const { "bg.json": _bg, ...files } = await snapshot(projectRoot);
    const { "bg.json": _first, ...firstFiles } = tree;
    expect(files).toEqual(firstFiles);
  });

  test("some leaves present and equal and others absent: applied, region by region", async () => {
    const { projectRoot, manifest } = await project();

    const result = await install(projectRoot, manifest, [
      dbModule([merge({ name: "my-app-api", vars: { NEW: "1" } })]),
    ]);

    expect(result.patches[0]).toMatchObject({
      status: "applied",
      regions: [
        { region: "name", status: "skipped" },
        { region: "vars.NEW", status: "applied" },
      ],
    });
  });

  test("a leaf that differs is user-owned: the install fails naming it, --force overwrites and reports what it replaced", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [dbModule()]);
    const edited = (await read(projectRoot, FILE)).replace('"local"', '"my-own-id"');
    await writeFile(join(projectRoot, FILE), edited);
    const before = await snapshot(projectRoot);

    await expect(install(projectRoot, first.manifest, [dbModule()])).rejects.toThrow(
      /nothing was written.*in the way \(use --force to overwrite\):\n {2}d1_databases of apps\/api\/wrangler\.jsonc is \[\{"binding":"DB","database_name":"my-app","database_id":"my-own-id"\}\], which differs from what db\/d1 declares \(\[\{"binding":"DB","database_name":"my-app","database_id":"local"\}\]\)/s,
    );
    expect(await snapshot(projectRoot)).toEqual(before);

    const forced = await install(projectRoot, first.manifest, [dbModule()], { force: true });

    expect(await read(projectRoot, FILE)).toBe(edited.replace('"my-own-id"', '"local"'));
    expect(forced.patches[0]?.regions).toEqual([
      {
        region: "d1_databases",
        status: "applied",
        replaced: '[{"binding":"DB","database_name":"my-app","database_id":"my-own-id"}]',
      },
    ]);
  });

  test("a leaf the project wrote itself, with no region recorded, is user-owned too", async () => {
    const { projectRoot, manifest } = await freshProject({
      [FILE]: '{ "d1_databases": [] }\n',
      "package.json": ROOT_PACKAGE,
    });

    await expect(install(projectRoot, manifest, [dbModule()])).rejects.toThrow(
      /d1_databases of apps\/api\/wrangler\.jsonc is \[\], which differs/,
    );
  });

  test("a region of another module fails always, even when the other module used scripts.merge", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [
      modulePlan({
        category: "dev",
        id: "other",
        key: "dev/other",
        patches: [patch({ lint: "vp lint" })],
      }),
    ]);
    const before = await snapshot(projectRoot);

    for (const force of [false, true]) {
      await expect(
        install(
          projectRoot,
          first.manifest,
          [dbModule([merge({ scripts: { lint: "vp lint" } }, "package.json")])],
          { force },
        ),
      ).rejects.toThrow(
        /nothing was written; --force does not change this:\n {2}scripts\.lint of package\.json is owned by dev\/other, and db\/d1 would write it/,
      );
    }
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("two modules merging one leaf in the same call fail, whoever comes first", async () => {
    const { projectRoot, manifest } = await project();

    await expect(
      install(projectRoot, manifest, [
        dbModule(),
        modulePlan({
          category: "dev",
          id: "other",
          key: "dev/other",
          patches: [merge({ d1_databases: [] })],
        }),
      ]),
    ).rejects.toThrow(
      /d1_databases of apps\/api\/wrangler\.jsonc is named by both db\/d1 and dev\/other/,
    );
  });

  describe("a patch that cannot apply is `failed`, recorded, and never aborts the install", () => {
    test.each([
      ["a target that does not exist", undefined, /^apps\/api\/wrangler\.jsonc does not exist$/],
      [
        "a target that is not JSON",
        '{\n  "a": \n}\n',
        /^apps\/api\/wrangler\.jsonc: not valid JSON \(.* at line 3\)$/,
      ],
      [
        "a root that is not an object",
        "[]\n",
        /^apps\/api\/wrangler\.jsonc: the root is not a JSON object$/,
      ],
    ])("%s", async (_, text, reason) => {
      const { projectRoot, manifest } = await freshProject(
        text === undefined ? {} : { [FILE]: text },
      );

      const result = await install(projectRoot, manifest, [
        dbModule([merge({ d1_databases: D1 })]),
      ]);

      expect(result.patches[0]?.status).toBe("failed");
      expect(result.patches[0]?.reason).toMatch(reason);
      expect(result.patches[0]?.regions).toEqual([]);
      expect(result.manifest.regions).toEqual({});
      expect(result.manifest.modules.db?.[0]?.patches[0]).toMatchObject({ status: "failed" });
      if (text !== undefined) {
        expect(await read(projectRoot, FILE)).toBe(text);
      }
    });

    test("a parent that is not an object", async () => {
      const { projectRoot, manifest } = await freshProject({ [FILE]: '{ "vars": "text" }\n' });

      const result = await install(projectRoot, manifest, [
        dbModule([merge({ vars: { A: "1" } })]),
      ]);

      expect(result.patches[0]).toMatchObject({
        status: "failed",
        reason: `${FILE}: "vars" is a string, not an object`,
      });
    });
  });

  test("--dry-run computes the merge, reports it and writes nothing", async () => {
    const { projectRoot, manifest } = await project();
    await writeFile(join(projectRoot, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await snapshot(projectRoot);

    const result = await install(projectRoot, manifest, [dbModule()], { dryRun: true });

    expect(result.patches[0]?.status).toBe("applied");
    expect(await snapshot(projectRoot)).toEqual(before);
  });
});

describe("applyInstallPlan: package.dependencies (060)", () => {
  const FILE = "apps/api/package.json";
  const API = `{
  "name": "@demo/api",
  "scripts": {
    "dev": "bun run dev"
  },
  "dependencies": {
    "@elysiajs/cors": "1.4.2",
    "elysia": "1.4.29"
  }
}
`;
  const entries = (
    dependencies: Record<string, string>,
    devDependencies: Record<string, string> = {},
    file = FILE,
  ) =>
    ({ type: "package.dependencies", file, dependencies, devDependencies }) satisfies PlannedPatch;
  const DB = { "@demo/db": "workspace:*" };
  const orm = (patches: PlannedPatch[] = [entries(DB)]) =>
    modulePlan({ category: "orm", id: "drizzle", key: "orm/drizzle", patches });
  const project = () => freshProject({ [FILE]: API, "package.json": ROOT_PACKAGE });

  test("writes each entry where the formatter sorts it, records a region per entry and the outcome", async () => {
    const { projectRoot, manifest } = await project();

    const result = await install(projectRoot, manifest, [
      orm([entries({ "@demo/db": "workspace:*", zod: "4.0.0" }, { typescript: "7.0.2" })]),
    ]);

    expect(await read(projectRoot, FILE)).toBe(`{
  "name": "@demo/api",
  "scripts": {
    "dev": "bun run dev"
  },
  "dependencies": {
    "@demo/db": "workspace:*",
    "@elysiajs/cors": "1.4.2",
    "elysia": "1.4.29",
    "zod": "4.0.0"
  },
  "devDependencies": {
    "typescript": "7.0.2"
  }
}
`);
    expect(result.patches).toEqual([
      {
        module: "orm/drizzle",
        type: "package.dependencies",
        file: FILE,
        status: "applied",
        regions: [
          { region: "dependencies.@demo/db", status: "applied" },
          { region: "dependencies.zod", status: "applied" },
          { region: "devDependencies.typescript", status: "applied" },
        ],
      },
    ]);
    expect(result.manifest.regions).toEqual({
      [FILE]: {
        "dependencies.@demo/db": "orm/drizzle",
        "dependencies.zod": "orm/drizzle",
        "devDependencies.typescript": "orm/drizzle",
      },
    });
    expect(result.manifest.modules.orm?.[0]?.patches).toEqual([
      { type: "package.dependencies", file: FILE, status: "applied" },
    ]);
    // The file belongs to the project, not to the module.
    expect(result.manifest.files).toEqual({});
  });

  test("the same install again skips every region, and the tree is the same bytes", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [orm()]);
    const { "bg.json": _first, ...tree } = await snapshot(projectRoot);

    const second = await install(projectRoot, first.manifest, [orm()]);

    expect(second.patches[0]).toMatchObject({
      status: "skipped",
      regions: [{ region: "dependencies.@demo/db", status: "skipped" }],
    });
    expect(second.manifest.regions).toEqual(first.manifest.regions);
    // A patch recorded `applied` stays so: the record describes the state, not the run.
    expect(second.manifest.modules.orm?.[0]?.patches[0]?.status).toBe("applied");
    const { "bg.json": _second, ...again } = await snapshot(projectRoot);
    expect(again).toEqual(tree);
  });

  test("some entries present and equal and others absent: applied, region by region", async () => {
    const { projectRoot, manifest } = await project();

    const result = await install(projectRoot, manifest, [
      orm([entries({ elysia: "1.4.29", zod: "4.0.0" })]),
    ]);

    expect(result.patches[0]).toMatchObject({
      status: "applied",
      regions: [
        { region: "dependencies.elysia", status: "skipped" },
        { region: "dependencies.zod", status: "applied" },
      ],
    });
    expect(result.manifest.regions[FILE]).toEqual({
      "dependencies.elysia": "orm/drizzle",
      "dependencies.zod": "orm/drizzle",
    });
  });

  test("a version that differs is user-owned: the install fails naming it, --force replaces it and reports what it replaced", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [orm()]);
    const edited = (await read(projectRoot, FILE)).replace("workspace:*", "workspace:^1.0.0");
    await writeFile(join(projectRoot, FILE), edited);
    const before = await snapshot(projectRoot);

    await expect(install(projectRoot, first.manifest, [orm()])).rejects.toThrow(
      /nothing was written.*in the way \(use --force to overwrite\):\n {2}dependencies\.@demo\/db of apps\/api\/package\.json is "workspace:\^1\.0\.0", which differs from what orm\/drizzle declares \("workspace:\*"\)/s,
    );
    expect(await snapshot(projectRoot)).toEqual(before);

    const forced = await install(projectRoot, first.manifest, [orm()], { force: true });

    expect(await read(projectRoot, FILE)).toBe(edited.replace("workspace:^1.0.0", "workspace:*"));
    expect(forced.patches[0]?.regions).toEqual([
      { region: "dependencies.@demo/db", status: "applied", replaced: '"workspace:^1.0.0"' },
    ]);
  });

  test("an entry the project wrote itself, with no region recorded, is user-owned too, and equal is claimed", async () => {
    const { projectRoot, manifest } = await freshProject({ [FILE]: API });

    await expect(
      install(projectRoot, manifest, [orm([entries({ elysia: "1.5.0" })])]),
    ).rejects.toThrow(
      /dependencies\.elysia of apps\/api\/package\.json is "1\.4\.29", which differs/,
    );

    const result = await install(projectRoot, manifest, [orm([entries({ elysia: "1.4.29" })])]);

    expect(result.patches[0]).toMatchObject({
      status: "skipped",
      regions: [{ region: "dependencies.elysia", status: "skipped" }],
    });
    expect(result.manifest.regions[FILE]).toEqual({ "dependencies.elysia": "orm/drizzle" });
  });

  test("an entry in the other map is another region: the same name in devDependencies is not in the way", async () => {
    const { projectRoot, manifest } = await project();

    const result = await install(projectRoot, manifest, [orm([entries({}, { elysia: "1.4.29" })])]);

    expect(result.patches[0]?.status).toBe("applied");
    expect(JSON.parse(await read(projectRoot, FILE))).toMatchObject({
      dependencies: { elysia: "1.4.29" },
      devDependencies: { elysia: "1.4.29" },
    });
  });

  test("a region of another module fails always, whichever patch type wrote it, and --force does not bypass it", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [
      modulePlan({
        category: "dev",
        id: "other",
        key: "dev/other",
        patches: [{ type: "jsonc.merge", file: FILE, value: { dependencies: { zod: "4.0.0" } } }],
      }),
    ]);
    const before = await snapshot(projectRoot);

    for (const force of [false, true]) {
      await expect(
        install(projectRoot, first.manifest, [orm([entries({ zod: "4.0.0" })])], { force }),
      ).rejects.toThrow(
        /nothing was written; --force does not change this:\n {2}dependencies\.zod of apps\/api\/package\.json is owned by dev\/other, and orm\/drizzle would write it/,
      );
    }
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("two modules naming one entry in the same call fail, whoever comes first", async () => {
    const { projectRoot, manifest } = await project();

    await expect(
      install(projectRoot, manifest, [
        orm(),
        modulePlan({
          category: "auth",
          id: "better-auth",
          key: "auth/better-auth",
          patches: [entries(DB)],
        }),
      ]),
    ).rejects.toThrow(
      /dependencies\.@demo\/db of apps\/api\/package\.json is named by both orm\/drizzle and auth\/better-auth/,
    );
  });

  test("lands in a file the same call writes, as the template's own entries would", async () => {
    const { projectRoot, manifest } = await freshProject({});
    const vendored = modulePlan({
      category: "db",
      id: "d1",
      key: "db/d1",
      files: [
        {
          target: "packages/db/package.json",
          content: `{
  "name": "@demo/db",
  "dependencies": {
    "@demo/api-runtime": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "5.0.0",
    "miniflare": "5.0.0"
  }
}
`,
        },
      ],
      patches: [],
    });

    await install(projectRoot, manifest, [
      vendored,
      orm([
        entries(
          { "drizzle-orm": "0.45.2", elysia: "1.4.29" },
          { "drizzle-kit": "0.31.10" },
          "packages/db/package.json",
        ),
      ]),
    ]);

    expect(JSON.parse(await read(projectRoot, "packages/db/package.json"))).toEqual({
      name: "@demo/db",
      dependencies: {
        "@demo/api-runtime": "workspace:*",
        "drizzle-orm": "0.45.2",
        elysia: "1.4.29",
      },
      devDependencies: {
        "@cloudflare/workers-types": "5.0.0",
        "drizzle-kit": "0.31.10",
        miniflare: "5.0.0",
      },
    });
    expect(
      Object.keys(
        (
          JSON.parse(await read(projectRoot, "packages/db/package.json")) as {
            devDependencies: object;
          }
        ).devDependencies,
      ),
    ).toEqual(["@cloudflare/workers-types", "drizzle-kit", "miniflare"]);
  });

  describe("a patch that cannot apply is `failed`, recorded, and becomes a pending intention", () => {
    test.each([
      ["a target that does not exist", undefined, /^apps\/api\/package\.json does not exist$/],
      [
        "a target that is not JSON",
        '{\n  "a": \n}\n',
        /^apps\/api\/package\.json: not valid JSON \(.* at line 3\)$/,
      ],
    ])("%s", async (_, text, reason) => {
      const { projectRoot, manifest } = await freshProject(
        text === undefined ? {} : { [FILE]: text },
      );

      const result = await install(projectRoot, manifest, [orm()]);

      expect(result.patches[0]?.status).toBe("failed");
      expect(result.patches[0]?.reason).toMatch(reason);
      expect(result.patches[0]?.regions).toEqual([]);
      expect(result.pending.map(({ id }) => id)).toEqual([
        "orm/drizzle/patch-package-dependencies-apps-api-package-json-dependencies-demo-db",
      ]);
      expect(result.manifest.regions).toEqual({});
      expect(result.manifest.modules.orm?.[0]?.patches[0]).toMatchObject({ status: "failed" });
      if (text !== undefined) {
        expect(await read(projectRoot, FILE)).toBe(text);
      }
    });

    test("a map that is not an object", async () => {
      const { projectRoot, manifest } = await freshProject({
        [FILE]: '{ "dependencies": ["a"] }\n',
      });

      const result = await install(projectRoot, manifest, [orm()]);

      expect(result.patches[0]).toMatchObject({
        status: "failed",
        reason: `${FILE}: "dependencies" is an array, not an object`,
      });
      expect(result.pending[0]?.intent).toBe(
        'The package.dependencies patch of orm/drizzle makes apps/api/package.json hold: dependencies.@demo/db = "workspace:*".',
      );
    });
  });

  test("--dry-run computes the patch, reports it and writes nothing", async () => {
    const { projectRoot, manifest } = await project();
    await writeFile(join(projectRoot, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await snapshot(projectRoot);

    const result = await install(projectRoot, manifest, [orm()], { dryRun: true });

    expect(result.patches[0]?.status).toBe("applied");
    expect(await snapshot(projectRoot)).toEqual(before);
  });
});

describe("applyInstallPlan: ts.addImport and ts.addNamedExport (060)", () => {
  const APP = 'import { Elysia } from "elysia";\n\nexport const app = new Elysia();\n';
  const FILE = "apps/api/src/app.ts";
  const importing = (names = ["authModule"], specifier = "@demo/auth", file = FILE) =>
    ({
      type: "ts.addImport",
      file,
      moduleSpecifier: specifier,
      namedImports: names,
    }) satisfies PlannedPatch;
  const exporting = (names = ["users"], specifier = "@demo/auth/schema", file = FILE) =>
    ({
      type: "ts.addNamedExport",
      file,
      moduleSpecifier: specifier,
      exports: names,
    }) satisfies PlannedPatch;
  const authModule = (patches: PlannedPatch[] = [importing()]) =>
    modulePlan({ category: "auth", id: "better-auth", key: "auth/better-auth", patches });
  const project = () => freshProject({ [FILE]: APP });

  test("adds the import and records its region, and the file is the same but for the line", async () => {
    const { projectRoot, manifest } = await project();

    const result = await install(projectRoot, manifest, [authModule([importing(), exporting()])]);

    expect(await read(projectRoot, FILE)).toBe(
      'import { Elysia } from "elysia";\nimport { authModule } from "@demo/auth";\nexport { users } from "@demo/auth/schema";\n\nexport const app = new Elysia();\n',
    );
    expect(result.patches.map(({ type, status, regions }) => ({ type, status, regions }))).toEqual([
      {
        type: "ts.addImport",
        status: "applied",
        regions: [{ region: "imports[@demo/auth]", status: "applied" }],
      },
      {
        type: "ts.addNamedExport",
        status: "applied",
        regions: [{ region: "exports[@demo/auth/schema]", status: "applied" }],
      },
    ]);
    expect(result.manifest.regions).toEqual({
      [FILE]: {
        "imports[@demo/auth]": "auth/better-auth",
        "exports[@demo/auth/schema]": "auth/better-auth",
      },
    });
    expect(result.manifest.files).toEqual({});
  });

  test("the same install again skips both, and the tree is the same bytes", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [authModule([importing(), exporting()])]);
    const tree = await snapshot(projectRoot);

    const second = await install(projectRoot, first.manifest, [
      authModule([importing(), exporting()]),
    ]);

    expect(second.patches.map(({ status }) => status)).toEqual(["skipped", "skipped"]);
    expect(second.manifest.regions).toEqual(first.manifest.regions);
    const { "bg.json": _bg, ...files } = await snapshot(projectRoot);
    const { "bg.json": _first, ...firstFiles } = tree;
    expect(files).toEqual(firstFiles);
  });

  test("a name the file already imports from the specifier is skipped, and the rest is added to that import", async () => {
    const { projectRoot, manifest } = await freshProject({
      [FILE]: 'import { a } from "@demo/auth";\n',
    });

    const result = await install(projectRoot, manifest, [authModule([importing(["a", "b"])])]);

    expect(await read(projectRoot, FILE)).toBe('import { a, b } from "@demo/auth";\n');
    expect(result.patches[0]?.status).toBe("applied");
  });

  test("a region of another module fails always, and so does one named twice in the call", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [authModule()]);
    const other = () =>
      modulePlan({
        category: "dev",
        id: "other",
        key: "dev/other",
        patches: [importing(["other"])],
      });
    const before = await snapshot(projectRoot);

    for (const force of [false, true]) {
      await expect(install(projectRoot, first.manifest, [other()], { force })).rejects.toThrow(
        /nothing was written; --force does not change this:\n {2}imports\[@demo\/auth\] of apps\/api\/src\/app\.ts is owned by auth\/better-auth, and dev\/other would write it/,
      );
    }
    await expect(install(projectRoot, manifest, [authModule(), other()])).rejects.toThrow(
      /imports\[@demo\/auth\] of apps\/api\/src\/app\.ts is named by both auth\/better-auth and dev\/other/,
    );
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("an import the project removed is added again by the next add: a presence has no value to disagree on", async () => {
    const { projectRoot, manifest } = await project();
    const first = await install(projectRoot, manifest, [authModule()]);
    await writeFile(join(projectRoot, FILE), APP);

    const again = await install(projectRoot, first.manifest, [authModule()]);

    expect(again.patches[0]?.status).toBe("applied");
    expect(await read(projectRoot, FILE)).toContain('import { authModule } from "@demo/auth";');
  });

  test.each([
    ["a target that does not exist", undefined, /^apps\/api\/src\/app\.ts does not exist$/],
    [
      "a target that is not TypeScript",
      "export const a = (;\n",
      /^apps\/api\/src\/app\.ts: not valid TypeScript \(.* at line 1\)$/,
    ],
    [
      "an import it would have to rewrite around a comment",
      'import { a /* keep */ } from "@demo/auth";\n',
      /^apps\/api\/src\/app\.ts: a comment inside the braces of the import from @demo\/auth would be lost/,
    ],
  ])(
    "a patch on %s is `failed`, recorded, and never aborts the install",
    async (_, text, reason) => {
      const { projectRoot, manifest } = await freshProject(
        text === undefined ? {} : { [FILE]: text },
      );

      const result = await install(projectRoot, manifest, [authModule()]);

      expect(result.patches[0]?.status).toBe("failed");
      expect(result.patches[0]?.reason).toMatch(reason);
      expect(result.manifest.regions).toEqual({});
      expect(result.manifest.modules.auth?.[0]?.patches[0]).toMatchObject({ status: "failed" });
      if (text !== undefined) {
        expect(await read(projectRoot, FILE)).toBe(text);
      }
    },
  );

  test("a file the same call writes is patched in the virtual tree, once, with the sha of what the module wrote", async () => {
    const { projectRoot, manifest } = await freshProject({});
    const shell = modulePlan({
      category: "api",
      id: "elysia",
      key: "api/elysia",
      files: [{ target: FILE, content: APP }],
      patches: [],
    });

    const result = await install(projectRoot, manifest, [shell, authModule()]);

    const landed = await read(projectRoot, FILE);
    expect(landed).toContain('import { authModule } from "@demo/auth";');
    expect(result.manifest.files[FILE]).toEqual({ owner: "api/elysia", sha256: sha256Hex(APP) });
    expect(result.written).toEqual([FILE]);
  });
});

describe("applyInstallPlan: ts.elysiaUse (060)", () => {
  const FILE = "apps/api/src/app.ts";
  const SEAM = `import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";

export const app = new Elysia()
  .use(cors())
  // Insertion point for the modules that plug into the API.
  .get("/health", () => ({ status: "ok" }));

export type App = typeof app;
`;
  const wiring = (module: string, specifier: string): PlannedPatch[] => [
    { type: "ts.addImport", file: FILE, moduleSpecifier: specifier, namedImports: [module] },
    { type: "ts.elysiaUse", file: FILE, targetName: "app", argument: module },
  ];
  const moduleOf = (category: "auth" | "db", id: string, patches: PlannedPatch[]): ModulePlan =>
    modulePlan({ category, id, key: `${category}/${id}`, patches });
  const auth = () => moduleOf("auth", "better-auth", wiring("authModule", "@demo/auth"));
  const shell = () =>
    modulePlan({
      category: "api",
      id: "elysia",
      key: "api/elysia",
      files: [{ target: FILE, content: SEAM }],
      patches: [],
    });
  const WIRED = SEAM.replace(
    'import { cors } from "@elysiajs/cors";\n',
    'import { cors } from "@elysiajs/cors";\nimport { authModule } from "@demo/auth";\n',
  ).replace("  .use(cors())\n", "  .use(cors())\n  .use(authModule)\n");

  test("inserts the .use above the routes and records the region, the import beside it", async () => {
    const { projectRoot, manifest } = await freshProject({ [FILE]: SEAM });

    const result = await install(projectRoot, manifest, [auth()]);

    expect(await read(projectRoot, FILE)).toBe(WIRED);
    expect(result.patches.map(({ type, status }) => [type, status])).toEqual([
      ["ts.addImport", "applied"],
      ["ts.elysiaUse", "applied"],
    ]);
    expect(result.patches[1]?.regions).toEqual([
      { region: "elysia[app].use[authModule]", status: "applied" },
    ]);
    expect(result.manifest.regions[FILE]).toEqual({
      "imports[@demo/auth]": "auth/better-auth",
      "elysia[app].use[authModule]": "auth/better-auth",
    });
  });

  test("the same install again skips both, and the tree is the same bytes", async () => {
    const { projectRoot, manifest } = await freshProject({ [FILE]: SEAM });
    const first = await install(projectRoot, manifest, [auth()]);
    const tree = await snapshot(projectRoot);

    const second = await install(projectRoot, first.manifest, [auth()]);

    expect(second.patches.map(({ status }) => status)).toEqual(["skipped", "skipped"]);
    const { "bg.json": _bg, ...files } = await snapshot(projectRoot);
    const { "bg.json": _first, ...firstFiles } = tree;
    expect(files).toEqual(firstFiles);
  });

  test("two modules plugging in one argument fail, whoever comes first, and --force does not bypass it", async () => {
    const { projectRoot, manifest } = await freshProject({ [FILE]: SEAM });
    const first = await install(projectRoot, manifest, [auth()]);
    const rival = moduleOf("db", "d1", [wiring("authModule", "@demo/other")[1]!]);

    for (const force of [false, true]) {
      await expect(install(projectRoot, first.manifest, [rival], { force })).rejects.toThrow(
        /elysia\[app\]\.use\[authModule\] of apps\/api\/src\/app\.ts is owned by auth\/better-auth, and db\/d1 would write it/,
      );
    }
  });

  test("a seam that is not there fails the patch, not the install: the module is recorded and the region is not", async () => {
    for (const [text, reason] of [
      [undefined, /^apps\/api\/src\/app\.ts does not exist$/],
      ["export const other = new Elysia();\n", /^apps\/api\/src\/app\.ts: no exported const app$/],
      [
        "export const app = createApp();\n",
        /^apps\/api\/src\/app\.ts: app is not a chain of calls rooted at new Elysia\(\.\.\.\)$/,
      ],
    ] as const) {
      const { projectRoot, manifest } = await freshProject(
        text === undefined ? {} : { [FILE]: text },
      );

      const result = await install(projectRoot, manifest, [auth()]);

      const use = result.patches.find(({ type }) => type === "ts.elysiaUse");
      expect(use?.status).toBe("failed");
      expect(use?.reason).toMatch(reason);
      expect(result.manifest.modules.auth?.[0]?.patches.map(({ status }) => status)).toContain(
        "failed",
      );
      expect(Object.keys(result.manifest.regions[FILE] ?? {})).not.toContain(
        "elysia[app].use[authModule]",
      );
    }
  });

  describe("on the file the api module vendors (the seam)", () => {
    test("the shell and a module that plugs into it, in one call, land as one file", async () => {
      const { projectRoot, manifest } = await freshProject({});

      const result = await install(projectRoot, manifest, [shell(), auth()]);

      const landed = await read(projectRoot, FILE);
      expect(landed).toBe(WIRED);
      expect(result.manifest.files[FILE]).toEqual({
        owner: "api/elysia",
        sha256: sha256Hex(SEAM),
      });
    });

    test("the project adds its own route; another module still plugs in, and the shell asked again keeps the file", async () => {
      const { projectRoot, manifest } = await freshProject({});
      const first = await install(projectRoot, manifest, [shell(), auth()]);
      const mine = (await read(projectRoot, FILE)).replace(
        '  .get("/health"',
        '  .get("/mine", () => 1)\n  .get("/health"',
      );
      await writeFile(join(projectRoot, FILE), mine);

      const db = moduleOf("db", "d1", wiring("dbModule", "@demo/db"));
      const second = await install(projectRoot, first.manifest, [db]);

      const expected = mine
        .replace(
          'import { authModule } from "@demo/auth";\n',
          'import { authModule } from "@demo/auth";\nimport { dbModule } from "@demo/db";\n',
        )
        .replace("  .use(authModule)\n", "  .use(authModule)\n  .use(dbModule)\n");
      expect(await read(projectRoot, FILE)).toBe(expected);

      const again = await install(projectRoot, second.manifest, [shell()]);

      expect(again.kept).toEqual([FILE]);
      expect(again.written).toEqual([]);
      expect(await read(projectRoot, FILE)).toBe(expected);
    });
  });
});

describe("applyInstallPlan: a module asked for again after a call that composed it with others (060)", () => {
  const PACKAGE = "packages/db/package.json";
  const VENDORED = `{
  "name": "@demo/db",
  "exports": {
    "./d1": "./src/d1.ts"
  },
  "scripts": {
    "test": "bun test"
  },
  "dependencies": {
    "@demo/api-runtime": "workspace:*"
  },
  "devDependencies": {
    "@cloudflare/workers-types": "5.0.0",
    "miniflare": "5.0.0"
  }
}
`;
  /** `db/d1`: vendors the package.json of `packages/db`, and its own scripts go to a file it does not write. */
  const d1 = () =>
    modulePlan({
      category: "db",
      id: "d1",
      key: "db/d1",
      files: [
        { target: PACKAGE, content: VENDORED },
        { target: "packages/db/src/d1.ts", content: "export const D1 = 1;\n" },
      ],
      patches: [
        patch(
          { "db:migrate:local": "wrangler d1 migrations apply DB --local" },
          "apps/api/package.json",
        ),
      ],
    });
  /** `orm/drizzle`: adds to the package.json `db/d1` vendors, with three kinds of patch. */
  const drizzle = () =>
    modulePlan({
      category: "orm",
      id: "drizzle",
      key: "orm/drizzle",
      files: [{ target: "packages/db/src/client.ts", content: "export const client = 1;\n" }],
      patches: [
        {
          type: "jsonc.merge",
          file: PACKAGE,
          value: { exports: { ".": "./src/index.ts" } },
        },
        patch({ "db:generate": "drizzle-kit generate" }, PACKAGE),
        {
          type: "package.dependencies",
          file: PACKAGE,
          dependencies: { "drizzle-orm": "0.45.2" },
          devDependencies: { "drizzle-kit": "0.31.10" },
        },
      ],
    });
  const API = `{
  "name": "@demo/api",
  "scripts": {
    "dev": "bun run dev"
  }
}
`;
  const files = () => ({ "apps/api/package.json": API, "package.json": ROOT_PACKAGE });
  /** What a re-add may move: the manifest's `installedAt`, nothing else. */
  const settled = (tree: Record<string, string>) => ({
    ...tree,
    "bg.json": (tree["bg.json"] ?? "").replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"'),
  });
  const onDisk = async (projectRoot: string, manifest: ProjectManifest) => {
    await writeFile(join(projectRoot, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return settled(await snapshot(projectRoot));
  };

  test("each module asked for alone after a one-call install skips every patch and changes nothing", async () => {
    const { projectRoot, manifest } = await freshProject(files());
    const first = await install(projectRoot, manifest, [d1(), drizzle()]);
    const tree = await onDisk(projectRoot, first.manifest);

    for (const module of [d1(), drizzle()]) {
      const again = await install(projectRoot, first.manifest, [module]);

      expect(again.patches.map(({ status }) => status)).toEqual(
        module.key === "db/d1" ? ["skipped"] : ["skipped", "skipped", "skipped"],
      );
      expect(again.written).toEqual([]);
      expect(await onDisk(projectRoot, again.manifest)).toEqual(tree);
    }
  });

  test("the record of a one-call install is the one two calls leave: what the module wrote, not what the patches made of it", async () => {
    const oneCall = await freshProject(files());
    const together = await install(oneCall.projectRoot, oneCall.manifest, [d1(), drizzle()]);
    const twoCalls = await freshProject(files());
    const first = await install(twoCalls.projectRoot, twoCalls.manifest, [d1()]);
    const second = await install(twoCalls.projectRoot, first.manifest, [drizzle()]);

    expect(together.manifest.files).toEqual(second.manifest.files);
    expect(together.manifest.files[PACKAGE]).toEqual({
      owner: "db/d1",
      sha256: sha256Hex(VENDORED),
    });
    expect(together.manifest.regions).toEqual(second.manifest.regions);
    expect(await read(oneCall.projectRoot, PACKAGE)).toBe(
      await read(twoCalls.projectRoot, PACKAGE),
    );
  });

  test("the shell asked for alone, after it was composed with a module that plugs into it in one call, keeps its file", async () => {
    const FILE = "apps/api/src/app.ts";
    const SEAM = `import { Elysia } from "elysia";

export const app = new Elysia()
  .get("/health", () => ({ status: "ok" }));
`;
    const shell = () =>
      modulePlan({
        category: "api",
        id: "elysia",
        key: "api/elysia",
        files: [{ target: FILE, content: SEAM }],
        patches: [],
      });
    const auth = () =>
      modulePlan({
        category: "auth",
        id: "better-auth",
        key: "auth/better-auth",
        patches: [
          {
            type: "ts.addImport",
            file: FILE,
            moduleSpecifier: "@demo/auth",
            namedImports: ["authModule"],
          },
          { type: "ts.elysiaUse", file: FILE, targetName: "app", argument: "authModule" },
        ],
      });
    const { projectRoot, manifest } = await freshProject({});
    const first = await install(projectRoot, manifest, [shell(), auth()]);
    const tree = await onDisk(projectRoot, first.manifest);

    const again = await install(projectRoot, first.manifest, [shell()]);

    expect(again.kept).toEqual([FILE]);
    expect(await onDisk(projectRoot, again.manifest)).toEqual(tree);
  });

  test("a vendored file the project edited and whose region it deleted gets the region back, and is still the project's afterwards", async () => {
    const own = () =>
      modulePlan({
        category: "dev",
        id: "tool",
        key: "dev/tool",
        files: [
          {
            target: "tools/package.json",
            content: '{\n  "name": "tools",\n  "scripts": {\n    "a": "1"\n  }\n}\n',
          },
        ],
        patches: [patch({ b: "2" }, "tools/package.json")],
      });
    const { projectRoot, manifest } = await freshProject({});
    const first = await install(projectRoot, manifest, [own()]);
    // The project adds a script of its own and removes the one the module's patch wrote.
    const mine = '{\n  "name": "tools",\n  "scripts": {\n    "a": "1",\n    "mine": "3"\n  }\n}\n';
    await writeFile(join(projectRoot, "tools/package.json"), mine);

    const second = await install(projectRoot, first.manifest, [own()]);
    expect(JSON.parse(await read(projectRoot, "tools/package.json"))).toMatchObject({
      scripts: { a: "1", mine: "3", b: "2" },
    });
    const restored = await read(projectRoot, "tools/package.json");
    const third = await install(projectRoot, second.manifest, [own()]);

    // The third add finds the file the project's, as the second did: nothing is overwritten.
    expect(await read(projectRoot, "tools/package.json")).toBe(restored);
    expect(third.written).toEqual([]);
    expect(third.manifest.files["tools/package.json"]?.sha256).toBe(
      first.manifest.files["tools/package.json"]?.sha256,
    );
  });
});

describe("applyInstallPlan: a failed patch becomes a pending intention (060 Degradation)", () => {
  const FILE = "apps/api/src/app.ts";
  const use = {
    type: "ts.elysiaUse",
    file: FILE,
    targetName: "app",
    argument: "authModule",
  } satisfies PlannedPatch;
  const ID = "auth/better-auth/patch-ts-elysia-use-apps-api-src-app-ts-elysia-app-use-auth-module";
  const auth = (patches: PlannedPatch[] = [use], checks: string[] = ["bun run test"]) =>
    modulePlan({ category: "auth", id: "better-auth", key: "auth/better-auth", patches, checks });
  const REASON = "apps/api/src/app.ts does not exist";

  test("a patch made to fail yields a pending intention, not a failed install", async () => {
    const { projectRoot, manifest } = await freshProject({});

    const result = await install(projectRoot, manifest, [auth()]);

    expect(result.pending).toEqual([
      {
        id: ID,
        module: "auth/better-auth",
        type: "ts.elysiaUse",
        file: FILE,
        intent:
          "The ts.elysiaUse patch of auth/better-auth makes apps/api/src/app.ts hold: elysia[app].use[authModule] = .use(authModule).",
        reason: REASON,
        gaps: ["elysia[app].use[authModule] of apps/api/src/app.ts is .use(authModule)"],
        checks: ["bun run test"],
      },
    ]);
    expect(result.patches[0]?.intention).toBe(ID);
    // The failure and the intention that tracks it are what `bg.json` keeps: `.bg/` is disposable.
    expect(result.manifest.modules.auth?.[0]?.patches).toEqual([
      { type: "ts.elysiaUse", file: FILE, status: "failed", reason: REASON, intention: ID },
    ]);
  });

  test("the module's own `intent` is the sentence the intention carries", async () => {
    const { projectRoot, manifest } = await freshProject({});

    const result = await install(projectRoot, manifest, [
      auth([{ ...use, intent: "Register the auth plugin on the API, above its routes" }]),
    ]);

    expect(result.pending[0]?.intent).toBe("Register the auth plugin on the API, above its routes");
  });

  test("a patch that applies, or is skipped, leaves nothing pending and no intention in the record", async () => {
    const { projectRoot, manifest } = await freshProject({
      [FILE]: 'export const app = new Elysia()\n  .use(a)\n  .get("/", () => 1);\n',
    });

    const result = await install(projectRoot, manifest, [auth()]);
    const again = await install(projectRoot, result.manifest, [auth()]);

    expect([result.pending, again.pending]).toEqual([[], []]);
    expect([result, again].map(({ manifest: next }) => next.modules.auth?.[0]?.patches[0])).toEqual(
      [
        { type: "ts.elysiaUse", file: FILE, status: "applied" },
        { type: "ts.elysiaUse", file: FILE, status: "applied" },
      ],
    );
  });

  test("the same failure on the next add is the same id, and an intention already recorded is not pending again", async () => {
    const { projectRoot, manifest } = await freshProject({});
    const first = await install(projectRoot, manifest, [auth()]);

    const second = await install(projectRoot, first.manifest, [auth()]);
    expect(second.pending.map(({ id }) => id)).toEqual([ID]);

    const outcomes: { applied: string[]; skipped: Record<string, string> }[] = [
      { applied: [ID], skipped: {} },
      { applied: [], skipped: { [ID]: "this project has no API" } },
    ];
    for (const outcome of outcomes) {
      const resolved = parseProjectManifest({
        ...first.manifest,
        modules: {
          auth: first.manifest.modules.auth?.map((record) => ({ ...record, intentions: outcome })),
        },
      });

      const third = await install(projectRoot, resolved, [auth()]);

      expect(third.pending).toEqual([]);
      expect(third.manifest.modules.auth?.[0]?.patches[0]).toMatchObject({
        status: "failed",
        intention: ID,
      });
      expect(third.manifest.modules.auth?.[0]?.intentions).toEqual(outcome);
    }
  });

  test("once the patch applies the failure and its intention leave the record, which `bg record` closed or not", async () => {
    const { projectRoot, manifest } = await freshProject({});
    const first = await install(projectRoot, manifest, [auth()]);
    await mkdir(join(projectRoot, "apps/api/src"), { recursive: true });
    await writeFile(join(projectRoot, FILE), "export const app = new Elysia();\n");

    const fixed = await install(projectRoot, first.manifest, [auth()]);

    expect(fixed.pending).toEqual([]);
    expect(fixed.manifest.modules.auth?.[0]?.patches).toEqual([
      { type: "ts.elysiaUse", file: FILE, status: "applied" },
    ]);
  });

  test("--dry-run reports what would be pending and writes nothing", async () => {
    const { projectRoot, manifest } = await freshProject({});
    await writeFile(join(projectRoot, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await snapshot(projectRoot);

    const result = await install(projectRoot, manifest, [auth()], { dryRun: true });

    expect(result.pending.map(({ id }) => id)).toEqual([ID]);
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("two failed patches of one module are two intentions, each its own id", async () => {
    const { projectRoot, manifest } = await freshProject({});

    const result = await install(projectRoot, manifest, [
      auth([use, { ...use, argument: "dbModule" }]),
    ]);

    expect(result.pending.map(({ id }) => id)).toEqual([
      ID,
      "auth/better-auth/patch-ts-elysia-use-apps-api-src-app-ts-elysia-app-use-db-module",
    ]);
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
