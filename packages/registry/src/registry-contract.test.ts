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
    // The API shell is the `api/elysia` module: an item cannot be required by a module, nor the reverse.
    expect(names.has("api-elysia")).toBe(false);
    // `config` is the `config/branding` module: an item cannot be required by a module, nor the reverse.
    expect(names.has("config")).toBe(false);
    for (const item of catalog.items) {
      for (const file of item.files ?? []) {
        expect(file.path.length).toBeGreaterThan(0);
        expect(file.type.length).toBeGreaterThan(0);
      }
    }
  });

  test("the only meta an item carries is needsModules, on a feature item: provides, requires, conflicts and transforms are gone (030)", async () => {
    const registries = await Array.fromAsync(
      new Bun.Glob("**/registry.json").scan({ cwd: join(ROOT, "registry") }),
    );
    // The raw files, and not the typed catalog: a field the loader no longer types still shows here.
    expect(registries).toContain("registry.json");
    expect(registries).toContain("ui/registry.json");
    expect(registries).toContain("features/registry.json");

    const wrong: string[] = [];
    for (const path of registries) {
      const raw: unknown = JSON.parse(await readFile(join(ROOT, "registry", path), "utf8"));
      const items =
        typeof raw === "object" && raw !== null && "items" in raw && Array.isArray(raw.items)
          ? raw.items
          : [];
      for (const item of items) {
        if (typeof item !== "object" || item === null || !("meta" in item)) {
          continue;
        }
        const name = "name" in item ? String(item.name) : "?";
        const keys =
          typeof item.meta === "object" && item.meta !== null ? Object.keys(item.meta) : ["?"];
        if (!path.startsWith("features/") || keys.join() !== "needsModules") {
          wrong.push(`${path}: ${name} carries meta [${keys}]`);
        }
      }
    }
    expect(wrong).toEqual([]);
    // `meta.bg` is the removed namespace, wherever it would be written.
    const features = await readFile(join(ROOT, "registry/features/registry.json"), "utf8");
    expect(features).not.toContain('"bg"');
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
  });
});

/** The UI items: the 29 components of the legacy `packages/ui`, its lib and its hook. */
const UI_ITEMS = [
  "alert",
  "alert-dialog",
  "animations",
  "avatar",
  "badge",
  "breadcrumb",
  "button",
  "card",
  "checkbox",
  "context-menu",
  "dialog",
  "drawer",
  "dropdown-menu",
  "empty-state",
  "entity-card",
  "input",
  "label",
  "popover",
  "progress",
  "select",
  "separator",
  "sheet",
  "sidebar",
  "skeleton",
  "switch",
  "table",
  "tabs",
  "textarea",
  "toggle",
  "tooltip",
  "use-mobile",
  "utils",
];
