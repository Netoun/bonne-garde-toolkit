import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isModuleCategory, parseModuleManifest } from "@bonne-garde/schema";
import { loadLocalRegistry } from "./load-registry";

const ROOT = join(import.meta.dir, "../../..");
const MODULES = join(ROOT, "registry/modules");

/** Every `registry/modules/<category>/<id>/module.json`, as [category, id, absolute path]. */
async function findModuleManifests(): Promise<[string, string, string][]> {
  if (!existsSync(MODULES)) return [];
  const found: [string, string, string][] = [];
  for (const category of await readdir(MODULES, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = join(MODULES, category.name);
    for (const module of await readdir(categoryDir, { withFileTypes: true })) {
      if (!module.isDirectory()) continue;
      const manifest = join(categoryDir, module.name, "module.json");
      if (existsSync(manifest)) {
        found.push([category.name, module.name, manifest]);
      }
    }
  }
  return found.sort((a, b) => a[2].localeCompare(b[2]));
}

describe("module contract", () => {
  test("every module.json parses, and its path agrees with its contents", async () => {
    const manifests = await findModuleManifests();

    // Spec 035 defines the native format; the first modules written to it are the two providers.
    expect(manifests.length).toBeGreaterThan(0);

    for (const [categoryDir, moduleDir, path] of manifests) {
      expect(isModuleCategory(categoryDir)).toBe(true);

      const manifest = parseModuleManifest(JSON.parse(await readFile(path, "utf8")));

      // The path is the identity: spec 035 puts a module at registry/modules/<category>/<id>/.
      expect<string>(manifest.category).toBe(categoryDir);
      expect(manifest.id).toBe(moduleDir);
    }
  });

  test("a module's copy globs stay out of an app's src", async () => {
    // Spec 035, package-dedicated seam: "MUST NOT write module source directly into apps/*/src".
    for (const [, id, path] of await findModuleManifests()) {
      const manifest = parseModuleManifest(JSON.parse(await readFile(path, "utf8")));
      for (const variant of manifest.variants) {
        for (const glob of variant.copy ?? []) {
          expect(`${id}:${glob}`).not.toMatch(/^.*:apps\/[^/]+\/src\//);
        }
      }
    }
  });

  test("both providers exist and peer on nothing", async () => {
    const ids = new Set<string>();
    for (const [category, id, path] of await findModuleManifests()) {
      if (category !== "provider") continue;
      ids.add(id);
      const manifest = parseModuleManifest(JSON.parse(await readFile(path, "utf8")));
      // `provider` is first in the topological order, so it has no peers by construction.
      expect(manifest.peers).toEqual({});
    }

    expect(ids).toEqual(new Set(["cloudflare", "dockerfile"]));
  });

  test("tooling/vite-plus is the quality gate: the Vite+ config and the pre-commit hook, no dependencies", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const found = catalog.modules.find(
      ({ manifest }) => manifest.category === "tooling" && manifest.id === "vite-plus",
    );
    if (!found) {
      throw new Error("registry/modules/tooling/vite-plus is missing");
    }
    const { manifest } = found;

    expect(manifest.peers).toEqual({});
    expect(manifest.checks).toEqual(["bun run check"]);
    expect(manifest.variants).toHaveLength(1);
    const [variant] = manifest.variants;
    expect(variant?.match).toEqual({});
    expect(variant?.copy).toEqual(["vite.config.ts", ".husky/pre-commit"]);
    // A repo-homed module needs an explicit `workspace` to declare dependencies, and `vite-plus` and
    // `husky` already come with the base template, so there is nothing for it to write into.
    expect(variant?.workspace).toBeUndefined();
    expect(variant?.dependencies ?? {}).toEqual({});
    expect(variant?.devDependencies ?? {}).toEqual({});
    expect(variant?.patch ?? []).toEqual([]);

    expect(await readFile(join(found.dir, "template/.husky/pre-commit"), "utf8")).toBe(
      "bunx vp staged\n",
    );
  });

  test("every copy glob of every variant matches a file under template/", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const unmatched: string[] = [];

    for (const { manifest, dir } of catalog.modules) {
      for (const variant of manifest.variants) {
        for (const glob of variant.copy ?? []) {
          const matches = await Array.fromAsync(
            new Bun.Glob(glob).scan({ cwd: join(dir, "template"), dot: true, onlyFiles: true }),
          );
          if (matches.length === 0) {
            unmatched.push(`${manifest.category}/${manifest.id} ${variant.key}: ${glob}`);
          }
        }
      }
    }

    expect(unmatched).toEqual([]);
  });

  test("no module id is also an item name, since `bg add <name>` would be ambiguous", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const itemNames = new Set(catalog.items.map((item) => item.name));

    expect(
      catalog.modules.map(({ manifest }) => manifest.id).filter((id) => itemNames.has(id)),
    ).toEqual([]);
  });
});
