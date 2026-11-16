import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadLocalRegistry } from "./load-registry";
import { patchRegions } from "./patch-ops";
import { plannedPatches } from "./patch-plan";

const ROOT = join(import.meta.dir, "../../..");

/** Every file under `dir`, as a path relative to it, sorted. */
async function filesUnder(dir: string, prefix = ""): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(join(dir, prefix), { withFileTypes: true })) {
    const path = prefix === "" ? entry.name : `${prefix}/${entry.name}`;
    found.push(...(entry.isDirectory() ? await filesUnder(dir, path) : [path]));
  }
  return found.sort();
}

async function portless() {
  const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
  const found = catalog.modules.find(
    ({ manifest }) => manifest.category === "dev" && manifest.id === "portless",
  );
  if (!found) {
    throw new Error("registry/modules/dev/portless is missing");
  }
  const [variant, ...others] = found.manifest.variants;
  if (!variant || others.length > 0) {
    throw new Error("dev/portless has to ship exactly one variant");
  }
  return { ...found, variant };
}

describe("dev/portless is the launcher of the apps' named HTTPS URLs (035, 060)", () => {
  test("peers on nothing, and ships one default variant: the launcher reads the apps, it does not match on them", async () => {
    const { manifest, variant } = await portless();

    expect(manifest.peers).toEqual({});
    expect(variant.key).toBe("default");
    expect(variant.match).toEqual({});
  });

  test("is repo-homed: no workspace and no dependency map, the one dependency is a patch on the root package.json", async () => {
    const { variant } = await portless();

    expect(variant.workspace).toBeUndefined();
    expect(variant.dependencies ?? {}).toEqual({});
    expect(variant.devDependencies ?? {}).toEqual({});
  });

  test("writes only under scripts/, from explicit paths that are every file of its template", async () => {
    const { variant, dir } = await portless();

    expect(variant.copy?.filter((path) => /[*?[\]{}]/.test(path))).toEqual([]);
    expect(variant.copy?.filter((path) => !path.startsWith("scripts/"))).toEqual([]);
    expect([...(variant.copy ?? [])].sort()).toEqual(await filesUnder(join(dir, "template")));
  });

  test("keeps the path 035's neighbours name: tooling/vite-plus lints scripts/** with no-console off for it", async () => {
    const { variant } = await portless();

    expect(variant.copy).toContain("scripts/dev-portless.ts");
    expect(variant.copy).toContain("scripts/dev-portless.test.ts");
  });

  test("adds the two root scripts and the exact portless devDependency, through the patches 060 lists", async () => {
    const { manifest, variant } = await portless();
    const patches = variant.patch ?? [];

    expect(patches).toEqual([
      {
        type: "scripts.merge",
        file: "package.json",
        scripts: {
          "dev:portless": "bun scripts/dev-portless.ts",
          "dev:lan:portless": "bun scripts/dev-portless.ts --lan",
        },
      },
      {
        type: "package.dependencies",
        file: "package.json",
        devDependencies: { portless: "0.15.6" },
      },
    ]);
    // Regions are what golden's PATCHED names and `bg remove` deletes.
    const regions = plannedPatches("dev/portless", variant, "@app").flatMap((patch) =>
      patchRegions(patch).map(({ region }) => region),
    );
    expect(regions.sort()).toEqual([
      "devDependencies.portless",
      "scripts.dev:lan:portless",
      "scripts.dev:portless",
    ]);
    expect(manifest.category).toBe("dev");
  });

  test("checks what it vendors: a typecheck of the launcher and its tests, then the tests", async () => {
    const { manifest, variant, dir } = await portless();

    expect(manifest.checks).toEqual([
      "bunx tsc --project scripts/dev-portless.tsconfig.json",
      "bun test ./scripts/dev-portless.test.ts",
    ]);
    const tsconfig: unknown = JSON.parse(
      await readFile(join(dir, "template/scripts/dev-portless.tsconfig.json"), "utf8"),
    );
    expect(tsconfig).toMatchObject({ include: ["dev-portless.ts", "dev-portless.test.ts"] });
    expect(variant.copy).toContain("scripts/dev-portless.tsconfig.json");
  });

  test("reads the apps from the project and names no app in its code", async () => {
    const { dir } = await portless();
    const source = await readFile(join(dir, "template/scripts/dev-portless.ts"), "utf8");

    // The legacy item was `AppKey = "api" | "spa" | "ssr" | "static"` and a list of four workspaces.
    expect(source).not.toMatch(/AppKey|apps\/(?:api|spa|ssr|static)\b/);
  });

  test("names no key of a module that reads it from the runtime: storage/r2 derives its own public url (035, 07)", async () => {
    const { dir } = await portless();
    const source = await readFile(join(dir, "template/scripts/dev-portless.ts"), "utf8");

    expect(source).not.toMatch(/R2_|BUCKET|v1\/media/);
  });
});
