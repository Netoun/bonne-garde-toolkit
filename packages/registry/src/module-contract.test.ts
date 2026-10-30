import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isModuleCategory, parseModuleManifest } from "@bonne-garde/schema";
import { loadLocalRegistry } from "./load-registry";

const ROOT = join(import.meta.dir, "../../..");
const MODULES = join(ROOT, "registry/modules");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

  test("tooling/vite-plus lints React code at the homes 035 fixes, and the server app as server code", async () => {
    const config: unknown = (
      await import(join(MODULES, "tooling/vite-plus/template/vite.config.ts"))
    ).default;
    const lint = isRecord(config) ? config.lint : undefined;
    const overrides = isRecord(lint) && Array.isArray(lint.overrides) ? lint.overrides : [];
    const named = (file: string) =>
      overrides.filter(
        (entry): entry is Record<string, unknown> =>
          isRecord(entry) && Array.isArray(entry.files) && entry.files.includes(file),
      );

    // `web` modules write `apps/<id>`, the UI items write `packages/ui`: ids are free, homes are not.
    for (const home of ["apps/*/**", "packages/ui/**"]) {
      const [react, ...others] = named(home);
      expect(others).toEqual([]);
      expect(react?.plugins).toContain("react");
      expect(react?.env).toMatchObject({ browser: true });
      expect(react?.excludeFiles).toEqual(["apps/api/**"]);
      // Enabling a plugin in an override switches none of its rules on, and a rule left at its
      // default is `warn`, which `vp check` passes: a violation only fails when the rule is named.
      expect(react?.rules).toMatchObject({ "react/jsx-key": "error" });
    }

    for (const home of ["apps/api/**", "scripts/**"]) {
      const [server, ...others] = named(home);
      expect(others).toEqual([]);
      expect(server?.rules).toEqual({ "no-console": "off" });
    }
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
