import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import {
  createEmptyProjectManifest,
  parseProjectManifest,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { ApplyError, applyInstallPlan } from "./apply-plan";
import type { ModulePlan } from "./module-plan";
import type { RegistryItem } from "./types";

/**
 * An item's `name@version` dependencies (030) are written into the `package.json` of the app its
 * files land in, as `package.dependencies` writes a module's (060): where the formatter sorts them,
 * and recorded as `dependencies.<name>` regions the item owns, so `doctor`, a re-add and a re-add of
 * the module alone leave the project as it is.
 */

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const NOW = () => "2026-02-02T00:00:00.000Z";
const APP_PACKAGE = "apps/spa/package.json";

const SHELL_PACKAGE = `${JSON.stringify(
  {
    name: "@demo/spa",
    version: "0.0.1",
    private: true,
    type: "module",
    scripts: { build: "react-router build" },
    dependencies: { "@demo/config": "workspace:*", react: "19.2.8" },
    devDependencies: { typescript: "7.0.2" },
  },
  null,
  2,
)}\n`;

/** The module that owns `apps/spa/package.json`, as `web/spa` does. */
function shell(): ModulePlan {
  return {
    category: "web",
    id: "spa",
    key: "web/spa",
    variant: "default",
    options: {},
    files: [{ target: APP_PACKAGE, content: SHELL_PACKAGE }],
    binaries: [],
    env: [],
    patches: [
      {
        type: "scripts.merge",
        file: APP_PACKAGE,
        scripts: { dev: "react-router dev" },
      },
    ],
    intentions: [],
    dependencies: {},
    devDependencies: {},
    workspace: null,
    checks: [],
  };
}

function signIn(overrides: Partial<RegistryItem> = {}): RegistryItem {
  return {
    name: "sign-in",
    type: "registry:block",
    dependencies: ["react", "better-auth@1.6.26", "@acme/auth@workspace:*", "zod@4.4.3"],
    devDependencies: ["vite-plus@0.2.8"],
    files: [
      {
        path: "sign-in/login.tsx",
        type: "registry:page",
        target: "apps/spa/src/features/auth/pages/auth-login-page.tsx",
        content: 'import { z } from "zod";\nexport default z;\n',
      },
    ],
    ...overrides,
  };
}

const plan = (...items: RegistryItem[]) => ({
  items,
  npmDependencies: [],
  npmDevDependencies: [],
});

async function freshProject(): Promise<{ projectRoot: string; manifest: ProjectManifest }> {
  const parent = await mkdtemp(join(tmpdir(), "bg-itemdeps-"));
  dirs.push(parent);
  const projectRoot = join(parent, "project");
  await mkdir(projectRoot);
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

type AppPackage = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

async function packageJson(root: string): Promise<AppPackage> {
  const parsed: unknown = JSON.parse(await readFile(join(root, APP_PACKAGE), "utf8"));
  return parsed as AppPackage;
}

/** The module on its own, then the item: the order in which a consumer adds a feature to an app. */
async function moduleThenItem(): Promise<{
  projectRoot: string;
  manifest: ProjectManifest;
}> {
  const { projectRoot, manifest } = await freshProject();
  const { manifest: installed } = await applyInstallPlan({
    projectRoot,
    manifest,
    plan: plan(),
    modules: [shell()],
    sourceLabel: "@bg",
    now: NOW,
  });
  return { projectRoot, manifest: installed };
}

describe("applyInstallPlan: an item's dependencies (030, 060)", () => {
  test("are written into the app's package.json where the formatter sorts them, scope rendered", async () => {
    const { projectRoot, manifest } = await moduleThenItem();

    await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    });

    const written = await packageJson(projectRoot);
    expect(Object.keys(written.dependencies)).toEqual([
      "@demo/auth",
      "@demo/config",
      "better-auth",
      "react",
      "zod",
    ]);
    expect(written.dependencies).toMatchObject({
      "@demo/auth": "workspace:*",
      "better-auth": "1.6.26",
      zod: "4.4.3",
    });
    expect(Object.keys(written.devDependencies)).toEqual(["typescript", "vite-plus"]);
    // A bare name is not written: `react` is the shell's, at the shell's version.
    expect(written.dependencies.react).toBe("19.2.8");
  });

  test("are regions the item owns, and the file stays the module's, at the sha the module wrote", async () => {
    const { projectRoot, manifest } = await moduleThenItem();
    const moduleSha = manifest.files[APP_PACKAGE]?.sha256;

    const { manifest: next, patches } = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    });

    expect(next.regions[APP_PACKAGE]).toMatchObject({
      "scripts.dev": "web/spa",
      "dependencies.@demo/auth": "sign-in",
      "dependencies.better-auth": "sign-in",
      "dependencies.zod": "sign-in",
      "devDependencies.vite-plus": "sign-in",
    });
    expect(next.files[APP_PACKAGE]).toEqual({ owner: "web/spa", sha256: moduleSha ?? "" });
    expect(
      patches.filter((patch) => patch.module === "sign-in").map((patch) => patch.status),
    ).toEqual(["applied"]);
    expect(
      parseProjectManifest(JSON.parse(await readFile(join(projectRoot, "bg.json"), "utf8"))),
    ).toEqual(next);
  });

  test("in the same call as the module that owns the file: one write, and the module's sha is the module's own", async () => {
    const { projectRoot, manifest } = await freshProject();

    const { manifest: next, patches } = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      modules: [shell()],
      sourceLabel: "@bg",
      now: NOW,
    });

    expect((await packageJson(projectRoot)).dependencies["better-auth"]).toBe("1.6.26");
    expect(next.files[APP_PACKAGE]?.owner).toBe("web/spa");
    const alone = await moduleThenItem();
    expect(next.files[APP_PACKAGE]).toEqual(alone.manifest.files[APP_PACKAGE]);
    expect(patches.map((patch) => [patch.module, patch.status])).toEqual([
      ["web/spa", "applied"],
      ["sign-in", "applied"],
    ]);
  });

  test("a second add reports the patch skipped and changes nothing but installedAt", async () => {
    const { projectRoot, manifest } = await moduleThenItem();
    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    });
    const before = await snapshot(projectRoot);

    const second = await applyInstallPlan({
      projectRoot,
      manifest: first.manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    });

    expect(second.patches.map((patch) => [patch.module, patch.status])).toEqual([
      ["sign-in", "skipped"],
    ]);
    expect(await snapshot(projectRoot)).toEqual(before);
    expect(second.manifest).toEqual(first.manifest);
  });

  test("the module added alone again keeps the file the item patched, and writes nothing", async () => {
    const { projectRoot, manifest } = await moduleThenItem();
    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    });
    const before = await snapshot(projectRoot);

    const again = await applyInstallPlan({
      projectRoot,
      manifest: first.manifest,
      plan: plan(),
      modules: [shell()],
      sourceLabel: "@bg",
      now: NOW,
    });

    expect(again.kept).toEqual([APP_PACKAGE]);
    expect(again.patches.map((patch) => patch.status)).toEqual(["skipped"]);
    expect(await snapshot(projectRoot)).toEqual(before);
    expect(again.manifest.regions).toEqual(first.manifest.regions);
  });

  test("a version the project changed is a collision that names the region, and --force replaces it", async () => {
    const { projectRoot, manifest } = await moduleThenItem();
    const first = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    });
    const text = await readFile(join(projectRoot, APP_PACKAGE), "utf8");
    await writeFile(join(projectRoot, APP_PACKAGE), text.replace('"4.4.3"', '"4.4.2"'));

    const refused = await applyInstallPlan({
      projectRoot,
      manifest: first.manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApplyError);
    expect((refused as Error).message).toContain("dependencies.zod");
    expect((refused as Error).message).toContain("sign-in");

    await applyInstallPlan({
      projectRoot,
      manifest: first.manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      force: true,
      now: NOW,
    });
    expect((await packageJson(projectRoot)).dependencies.zod).toBe("4.4.3");
  });

  test("a package.json the project lacks refuses the install, names it, and writes nothing", async () => {
    const { projectRoot, manifest } = await freshProject();

    const refused = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      now: NOW,
    }).catch((error: unknown) => error);

    expect(refused).toBeInstanceOf(ApplyError);
    expect((refused as Error).message).toContain(APP_PACKAGE);
    expect(await readdir(projectRoot)).toEqual([]);
  });

  test("--dry-run reports the patch and writes nothing", async () => {
    const { projectRoot, manifest } = await moduleThenItem();
    const before = await snapshot(projectRoot);

    const { patches } = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn()),
      sourceLabel: "@bg",
      dryRun: true,
      now: NOW,
    });

    expect(patches.map((patch) => [patch.module, patch.status])).toEqual([["sign-in", "applied"]]);
    expect(await snapshot(projectRoot)).toEqual(before);
  });

  test("an item with bare names only writes no package.json and needs none", async () => {
    const { projectRoot, manifest } = await freshProject();

    const { patches } = await applyInstallPlan({
      projectRoot,
      manifest,
      plan: plan(signIn({ dependencies: ["react"], devDependencies: undefined })),
      sourceLabel: "@bg",
      now: NOW,
    });

    expect(patches).toEqual([]);
    expect(Object.keys(await snapshot(projectRoot)).sort()).toEqual([
      "apps/spa/src/features/auth/pages/auth-login-page.tsx",
      "bg.json",
    ]);
  });
});
