import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { loadLocalRegistry } from "./load-registry";

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
});
