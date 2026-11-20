import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { MODULE_CATEGORIES } from "@bonne-garde/schema";
import { describe, expect, it } from "vite-plus/test";

import { listModules } from "./modules";

const modulesDir = resolve(process.cwd(), "../../registry/modules");

function moduleDirs(): string[] {
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .flatMap((category) =>
      readdirSync(resolve(modulesDir, category.name), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => `/modules/${category.name}/${entry.name}`),
    );
}

describe("listModules", () => {
  it("links one page per module.json", async () => {
    const hrefs = (await listModules()).flatMap((section) =>
      section.links.map((link) => link.href),
    );

    expect([...hrefs].sort()).toEqual(moduleDirs().sort());
  });

  it("orders the sections like MODULE_CATEGORIES and skips empty categories", async () => {
    const titles = (await listModules()).map((section) => section.title);
    const expected = MODULE_CATEGORIES.filter((category) =>
      moduleDirs().some((href) => href.startsWith(`/modules/${category}/`)),
    );

    expect(titles).toEqual(expected);
  });
});
