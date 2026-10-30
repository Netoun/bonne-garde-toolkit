import { afterAll, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createEmptyProjectManifest,
  parseProjectManifest,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { applyInstallPlan, ApplyError } from "./apply-plan";
import type { InstallPlan } from "./resolve-plan";
import type { RegistryItem } from "./types";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const plan: InstallPlan = {
  items: [
    {
      name: "greeting",
      type: "registry:lib",
      files: [
        { path: "greeting.ts", type: "registry:lib", target: "src/greeting.ts", content: "x" },
      ],
    },
  ],
  capabilities: [],
  npmDependencies: [],
  npmDevDependencies: [],
  transforms: [],
};

describe("applyInstallPlan", () => {
  test("records items under `items`, adds the new file, and carries every other v2 field through", async () => {
    const projectRoot = await mkdtemp(join(tmpdir(), "bg-apply-"));
    dirs.push(projectRoot);

    const sha256 = "b".repeat(64);
    const manifest = parseProjectManifest({
      ...createEmptyProjectManifest({ scope: "@acme", registries: {} }),
      apps: [{ id: "api", dir: "apps/api", kind: "worker" }],
      modules: {
        auth: [
          {
            id: "better-auth",
            variant: "default",
            version: "0.0.0",
            installedAt: "2026-01-01T00:00:00.000Z",
            options: {},
            patches: [],
            intentions: { applied: [], skipped: {} },
          },
        ],
      },
      files: { "packages/auth/src/index.ts": { owner: "auth/better-auth", sha256 } },
      regions: { "apps/api/src/app.ts": { "elysia[app].use[auth]": "auth/better-auth" } },
    });

    const { manifest: next } = await applyInstallPlan({
      projectRoot,
      manifest,
      plan,
      sourceLabel: "@bg",
      now: () => "2026-02-02T00:00:00.000Z",
    });

    expect(next.items.greeting).toEqual({
      source: "@bg/greeting",
      version: "0.0.0",
      installedAt: "2026-02-02T00:00:00.000Z",
    });
    expect(next.apps).toEqual(manifest.apps);
    expect(next.modules).toEqual(manifest.modules);
    expect(next.files).toEqual({
      ...manifest.files,
      "src/greeting.ts": {
        owner: "greeting",
        sha256: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
      },
    });
    expect(next.regions).toEqual(manifest.regions);

    const onDisk = JSON.parse(await readFile(join(projectRoot, "bg.json"), "utf8")) as unknown;
    expect(parseProjectManifest(onDisk)).toEqual(next);
  });
});

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function planOf(...items: RegistryItem[]): InstallPlan {
  return { ...plan, items };
}

function libItem(name: string, files: Record<string, string>): RegistryItem {
  return {
    name,
    type: "registry:lib",
    files: Object.entries(files).map(([target, content]) => ({
      path: `${name}/${target}`,
      type: "registry:file",
      target,
      content,
    })),
  };
}

/** The project sits one level down, so a write that escapes it still lands in a dir we clean up. */
async function freshProject(): Promise<{
  parent: string;
  projectRoot: string;
  manifest: ProjectManifest;
}> {
  const parent = await mkdtemp(join(tmpdir(), "bg-apply-"));
  dirs.push(parent);
  const projectRoot = join(parent, "project");
  await mkdir(projectRoot);
  return {
    parent,
    projectRoot,
    manifest: createEmptyProjectManifest({ scope: "@demo", registries: {} }),
  };
}

async function bgJson(projectRoot: string): Promise<string> {
  return readFile(join(projectRoot, "bg.json"), "utf8");
}

/** `installedAt` is the one field a re-add is allowed to move. */
function withoutInstalledAt(json: string): string {
  return json.replace(/"installedAt": "[^"]*"/g, '"installedAt": "-"');
}

const LATER = () => "2026-03-03T00:00:00.000Z";

describe("applyInstallPlan: files", () => {
  test("records the owner and sha256 of every file it writes", async () => {
    const { projectRoot, manifest } = await freshProject();
    const lib = libItem("greeting", {
      "src/greeting.ts": "x",
      "src/deep/other.ts": "export {};\n",
    });

    const result = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(lib),
      sourceLabel: "@bg",
    });

    expect(result.written).toEqual(["src/greeting.ts", "src/deep/other.ts"]);
    // sha256("x"), written out so the test does not recompute with the code under test
    expect(result.manifest.files["src/greeting.ts"]).toEqual({
      owner: "greeting",
      sha256: "2d711642b726b04401627ca9fbac32f5c8530fb1903cc4db02258717921a4881",
    });
    expect(Object.keys(result.manifest.files).sort()).toEqual([...result.written].sort());
    for (const [path, record] of Object.entries(result.manifest.files)) {
      expect(record.sha256).toBe(sha256Hex(await readFile(join(projectRoot, path), "utf8")));
    }
    expect(parseProjectManifest(JSON.parse(await bgJson(projectRoot)))).toEqual(result.manifest);
  });

  test("hashes what was written, after the scope placeholder is rewritten", async () => {
    const { projectRoot, manifest } = await freshProject();
    const lib = libItem("scoped", { "src/index.ts": 'import "@acme/ui";\n' });

    const { manifest: next } = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(lib),
      sourceLabel: "@bg",
    });

    const onDisk = await readFile(join(projectRoot, "src/index.ts"), "utf8");
    expect(onDisk).toBe('import "@demo/ui";\n');
    expect(next.files["src/index.ts"]?.sha256).toBe(sha256Hex(onDisk));
  });

  test("a second apply skips every file and leaves bg.json identical but for installedAt", async () => {
    const { projectRoot, manifest } = await freshProject();
    const plan2 = planOf(libItem("a", { "src/a.ts": "a" }), libItem("b", { "src/b.ts": "b" }));

    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan2,
      sourceLabel: "@bg",
    });
    const firstJson = await bgJson(projectRoot);

    const second = await applyInstallPlan({
      projectRoot,
      manifest: first.manifest,
      plan: plan2,
      sourceLabel: "@bg",
      now: LATER,
    });

    expect(second.written).toEqual([]);
    expect(second.skippedIdentical).toEqual(["src/a.ts", "src/b.ts"]);
    expect(Object.keys(second.manifest.files)).toEqual(["src/a.ts", "src/b.ts"]);
    expect(second.manifest.files).toEqual(first.manifest.files);
    const secondJson = await bgJson(projectRoot);
    expect(secondJson).not.toBe(firstJson);
    expect(withoutInstalledAt(secondJson)).toBe(withoutInstalledAt(firstJson));
  });

  test("a file already on disk and identical, with no record, is claimed by the re-add", async () => {
    const { projectRoot, manifest } = await freshProject();
    await mkdir(join(projectRoot, "src"), { recursive: true });
    await writeFile(join(projectRoot, "src/a.ts"), "a");

    const result = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(libItem("a", { "src/a.ts": "a" })),
      sourceLabel: "@bg",
    });

    expect(result.written).toEqual([]);
    expect(result.skippedIdentical).toEqual(["src/a.ts"]);
    expect(result.manifest.files["src/a.ts"]).toEqual({ owner: "a", sha256: sha256Hex("a") });
  });

  test("a skipped file keeps the owner it already had", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(libItem("a", { "src/shared.ts": "s" })),
      sourceLabel: "@bg",
    });

    const second = await applyInstallPlan({
      projectRoot,
      manifest: first.manifest,
      plan: planOf(libItem("b", { "src/shared.ts": "s" })),
      sourceLabel: "@bg",
    });

    expect(second.skippedIdentical).toEqual(["src/shared.ts"]);
    expect(second.manifest.files["src/shared.ts"]?.owner).toBe("a");
  });

  test("--force records the new sha256 and the installing item as owner", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(libItem("a", { "src/a.ts": "old" })),
      sourceLabel: "@bg",
    });

    const second = await applyInstallPlan({
      projectRoot,
      manifest: first.manifest,
      plan: planOf(libItem("b", { "src/a.ts": "new" })),
      sourceLabel: "@bg",
      force: true,
    });

    expect(second.written).toEqual(["src/a.ts"]);
    expect(second.manifest.files["src/a.ts"]).toEqual({ owner: "b", sha256: sha256Hex("new") });
    expect(await readFile(join(projectRoot, "src/a.ts"), "utf8")).toBe("new");
  });

  test("a collision throws and leaves the tree and bg.json as they were", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(libItem("a", { "src/a.ts": "mine" })),
      sourceLabel: "@bg",
    });
    await writeFile(join(projectRoot, "src/a.ts"), "edited by the user");
    const before = await bgJson(projectRoot);

    await expect(
      applyInstallPlan({
        projectRoot,
        manifest: first.manifest,
        plan: planOf(libItem("a", { "src/a.ts": "theirs", "src/new.ts": "n" })),
        sourceLabel: "@bg",
      }),
    ).rejects.toBeInstanceOf(ApplyError);

    expect(await bgJson(projectRoot)).toBe(before);
    expect(await readFile(join(projectRoot, "src/a.ts"), "utf8")).toBe("edited by the user");
    await expect(stat(join(projectRoot, "src/new.ts"))).rejects.toThrow();
  });

  test("a write error midway leaves no new file, no new directory and bg.json as it was", async () => {
    const { projectRoot, manifest } = await freshProject();
    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(libItem("a", { "src/a.ts": "mine" })),
      sourceLabel: "@bg",
    });
    // `blocker` is a file, so `blocker/last.ts` cannot be created: the failure comes after the
    // writes before it succeeded, which no check made before writing can see.
    await writeFile(join(projectRoot, "blocker"), "a file in the way");
    const before = await bgJson(projectRoot);

    await expect(
      applyInstallPlan({
        projectRoot,
        manifest: first.manifest,
        plan: planOf(
          libItem("b", { "src/b.ts": "b", "deep/er/c.ts": "c", "blocker/last.ts": "last" }),
        ),
        sourceLabel: "@bg",
      }),
    ).rejects.toThrow();

    expect(await bgJson(projectRoot)).toBe(before);
    await expect(stat(join(projectRoot, "src/b.ts"))).rejects.toThrow();
    await expect(stat(join(projectRoot, "deep"))).rejects.toThrow();
    expect(await readFile(join(projectRoot, "src/a.ts"), "utf8")).toBe("mine");
    expect((await readdir(join(projectRoot, "src"))).sort()).toEqual(["a.ts"]);
  });

  test("a target that leaves the project is refused before anything is written", async () => {
    const { parent, projectRoot, manifest } = await freshProject();

    await expect(
      applyInstallPlan({
        projectRoot,
        manifest,
        plan: planOf(libItem("escape", { "src/ok.ts": "ok", "../outside.ts": "no" })),
        sourceLabel: "@bg",
      }),
    ).rejects.toThrow("repo-relative");

    await expect(stat(join(parent, "outside.ts"))).rejects.toThrow();
    await expect(stat(join(projectRoot, "src/ok.ts"))).rejects.toThrow();
    await expect(stat(join(projectRoot, "bg.json"))).rejects.toThrow();
  });

  test("--dry-run returns the records it would write and touches nothing", async () => {
    const { projectRoot, manifest } = await freshProject();
    await writeFile(join(projectRoot, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const before = await bgJson(projectRoot);

    const result = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: planOf(libItem("a", { "src/a.ts": "a" })),
      sourceLabel: "@bg",
      dryRun: true,
    });

    expect(result.written).toEqual(["src/a.ts"]);
    expect(result.manifest.files["src/a.ts"]).toEqual({ owner: "a", sha256: sha256Hex("a") });
    expect(await bgJson(projectRoot)).toBe(before);
    await expect(stat(join(projectRoot, "src"))).rejects.toThrow();
  });
});
