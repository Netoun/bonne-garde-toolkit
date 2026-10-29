import { describe, expect, test } from "bun:test";
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
});
