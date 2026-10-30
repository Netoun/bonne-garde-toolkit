import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadLocalRegistry } from "./load-registry";
import type { RegistryItem } from "./types";

const ROOT = join(import.meta.dir, "../../..");

describe("registry contract", () => {
  test("loads root registry with required MVP items", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const names = new Set(catalog.items.map((i) => i.name));
    expect(catalog.name).toBe("bonne-garde");
    expect(names.has("button")).toBe(true);
    expect(names.has("utils")).toBe(true);
    expect(names.has("api-elysia")).toBe(true);
    expect(names.has("config")).toBe(true);
    for (const item of catalog.items) {
      for (const file of item.files ?? []) {
        expect(file.path.length).toBeGreaterThan(0);
        expect(file.type.length).toBeGreaterThan(0);
      }
    }
  });

  test("no registry.json carries `meta`: provides, requires, conflicts and transforms are gone (030)", async () => {
    const registries = await Array.fromAsync(
      new Bun.Glob("**/registry.json").scan({ cwd: join(ROOT, "registry") }),
    );
    // The raw files, and not the typed catalog: a field the loader no longer types still shows here.
    expect(registries).toContain("registry.json");
    expect(registries).toContain("ui/registry.json");

    const carrying: string[] = [];
    for (const path of registries) {
      const raw: unknown = JSON.parse(await readFile(join(ROOT, "registry", path), "utf8"));
      const items =
        typeof raw === "object" && raw !== null && "items" in raw && Array.isArray(raw.items)
          ? raw.items
          : [];
      for (const item of items) {
        if (typeof item === "object" && item !== null && "meta" in item) {
          carrying.push(`${path}: ${"name" in item ? String(item.name) : "?"}`);
        }
      }
      expect(JSON.stringify(raw)).not.toContain('"meta"');
    }
    expect(carrying).toEqual([]);
  });

  test("no item creates the host package of `ui`: package.json, tsconfig.json and components.json are the module's (030)", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const hostFiles = new Set([
      "packages/ui/package.json",
      "packages/ui/tsconfig.json",
      "packages/ui/components.json",
    ]);

    const offenders = catalog.items.flatMap((item) =>
      (item.files ?? [])
        .filter((file) => file.target !== undefined && hostFiles.has(file.target))
        .map((file) => `${item.name}: ${file.target}`),
    );

    expect(offenders).toEqual([]);
  });

  describe("the UI items (030, 080)", () => {
    const uiItems = async (): Promise<RegistryItem[]> => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      return catalog.items.filter((item) =>
        (item.files ?? []).some((file) => file.target?.startsWith("packages/ui/")),
      );
    };

    /** The items a file imports: `@acme/ui/{components,lib,hooks}/<x>` and `./<x>`, by item name. */
    const siblingsOf = (source: string): string[] => {
      const names = new Set<string>();
      for (const [, subpath] of source.matchAll(
        /from\s+"@acme\/ui\/(?:components|lib|hooks)\/([^"]+)"/g,
      )) {
        names.add(subpath ?? "");
      }
      for (const [, sibling] of source.matchAll(/from\s+"\.\/([^"]+)"/g)) {
        names.add(sibling ?? "");
      }
      return [...names].sort();
    };

    test("the catalog is the legacy packages/ui: 29 components, lib/animations, lib/utils, hooks/use-mobile", async () => {
      expect((await uiItems()).map((item) => item.name).sort()).toEqual(UI_ITEMS);
    });

    test("every item's files exist, and each lands under packages/ui/src with the type its folder says", async () => {
      const wrong: string[] = [];
      for (const item of await uiItems()) {
        for (const file of item.files ?? []) {
          const folder = /^packages\/ui\/src\/([^/]+)\//.exec(file.target ?? "")?.[1];
          const expected =
            { components: "registry:ui", lib: "registry:lib", hooks: "registry:hook" }[
              folder ?? ""
            ] ?? "?";
          if (!existsSync(file.path) || file.type !== expected || item.type !== expected) {
            wrong.push(`${item.name}: ${file.path} as ${file.type} -> ${file.target}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    test("an item declares exactly the items its file imports, so `bg add <item>` brings what it needs and no more", async () => {
      const wrong: string[] = [];
      for (const item of await uiItems()) {
        const imported = new Set<string>();
        for (const file of item.files ?? []) {
          for (const sibling of siblingsOf(await readFile(file.path, "utf8"))) {
            imported.add(sibling);
          }
        }
        const declared = [...(item.registryDependencies ?? [])].sort();
        if (JSON.stringify(declared) !== JSON.stringify([...imported].sort())) {
          wrong.push(`${item.name}: declares [${declared}], imports [${[...imported].sort()}]`);
        }
      }
      expect(wrong).toEqual([]);
    });

    test("an item lists the npm packages its file imports, `react` included", async () => {
      const wrong: string[] = [];
      for (const item of await uiItems()) {
        const imported = new Set<string>();
        for (const file of item.files ?? []) {
          if (!/\.tsx?$/.test(file.path)) {
            continue;
          }
          for (const name of packagesOf(await readFile(file.path, "utf8"))) {
            imported.add(name);
          }
        }
        const declared = [...(item.dependencies ?? [])].sort();
        if (JSON.stringify(declared) !== JSON.stringify([...imported].sort())) {
          wrong.push(`${item.name}: lists [${declared}], imports [${[...imported].sort()}]`);
        }
      }
      expect(wrong).toEqual([]);
    });

    /** The npm packages a file imports from: `@scope/name` or `name`, subpaths folded, `@acme/ui` not one. */
    const packagesOf = (source: string): string[] => [
      ...new Set(
        [...source.matchAll(/from\s+"([^".][^"]*)"/g)].flatMap(([, specifier = ""]) => {
          const [first = "", second = ""] = specifier.split("/");
          const name = first.startsWith("@") ? `${first}/${second}` : first;
          return name === "@acme/ui" ? [] : [name];
        }),
      ),
    ];

    const LEGACY = join(ROOT, "packages/ui/src");
    test.skipIf(!existsSync(LEGACY))(
      "while the legacy package is in the tree, each item is its file byte for byte (080: no rewrites)",
      async () => {
        const different: string[] = [];
        for (const item of await uiItems()) {
          for (const file of item.files ?? []) {
            const legacy = join(LEGACY, (file.target ?? "").slice("packages/ui/src/".length));
            if (!existsSync(legacy)) {
              different.push(`${item.name}: no ${legacy}`);
            } else if ((await readFile(legacy, "utf8")) !== (await readFile(file.path, "utf8"))) {
              different.push(`${item.name}: differs from ${legacy}`);
            }
          }
        }
        expect(different).toEqual([]);
      },
    );
  });
});

/** The UI items at this commit, by name. */
const UI_ITEMS = ["animations", "badge", "button", "card", "utils"];
