import { loadLocalRegistry } from "@bonne-garde/registry";
import { join } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { getRepoRoot } from "../lib/registry";
import { itemHref } from "../lib/items";
import { listItems } from "./items";

describe("listItems", () => {
  it("lists one nav entry per item in the UI and features catalogs", async () => {
    const catalog = await loadLocalRegistry(join(getRepoRoot(), "registry/registry.json"));
    const sections = await listItems();
    const links = sections.flatMap((section) => section.links);

    expect(links).toHaveLength(catalog.items.length);
    for (const item of catalog.items) {
      expect(links.map((link) => link.href)).toContain(itemHref(item));
    }
  });
});
