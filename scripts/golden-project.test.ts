import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { loadLocalRegistry } from "../packages/registry/src/index";
import { EXCLUDED, selectItems } from "./golden-project";

const LISTING = [
  "utils\tregistry:lib\tcn() helper for className merging.",
  "button\tregistry:ui\tPrimary button component.",
  "api-elysia\tregistry:block\tMinimal Cloudflare Workers API shell with Elysia health route.",
  "",
].join("\n");

describe("selectItems", () => {
  test("takes the first tab-separated column of every line", () => {
    expect(selectItems(LISTING, {})).toEqual({
      items: ["utils", "button", "api-elysia"],
      excluded: [],
    });
  });

  test("keeps an excluded item out of the install list and reports why", () => {
    const { items, excluded } = selectItems(LISTING, { button: "needs a consumer app" });
    expect(items).toEqual(["utils", "api-elysia"]);
    expect(excluded).toEqual([{ name: "button", reason: "needs a consumer app" }]);
  });

  test("tolerates a description with no tab and a name with trailing spaces", () => {
    expect(selectItems("utils \nbutton\tregistry:ui\n", {}).items).toEqual(["utils", "button"]);
  });

  test("fails when an exclusion names an item the registry no longer lists", () => {
    expect(() => selectItems(LISTING, { ghost: "was removed" })).toThrow(/ghost/);
  });

  test("fails when the listing is empty, so a broken `bg list` is not a green run", () => {
    expect(() => selectItems("\n", {})).toThrow(/no items/);
  });

  test("fails when every listed item is excluded", () => {
    expect(() => selectItems("utils\tregistry:lib\tx\n", { utils: "nope" })).toThrow(/no items/);
  });
});

describe("the golden project", () => {
  test("installs every item the registry lists", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.items.map((item) => `${item.name}\t${item.type}`).join("\n");

    expect(selectItems(listing, EXCLUDED).items).toContain("spa-react-router");
  });
});
