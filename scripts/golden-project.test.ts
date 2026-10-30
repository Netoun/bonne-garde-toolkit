import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { loadLocalRegistry } from "../packages/registry/src/index";
import {
  EXCLUDED,
  EXCLUDED_MODULES,
  MODULES,
  readAddedModules,
  selectItems,
  selectModules,
} from "./golden-project";

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

const FULL_LISTING = [
  LISTING.trimEnd(),
  "provider/cloudflare\tmodule\tWorkers runtime.",
  "provider/dockerfile\tmodule\tOne Bun container.",
  "tooling/vite-plus\tmodule\tVite+ lint and fmt.",
  "",
].join("\n");

describe("selectModules", () => {
  const exclusions = {
    "provider/cloudflare": "collides with api-elysia",
    "provider/dockerfile": "one provider per project",
  };

  test("takes the module lines of `bg list` and skips the items", () => {
    expect(selectModules(FULL_LISTING, ["tooling/vite-plus"], exclusions)).toEqual({
      modules: ["tooling/vite-plus"],
      excluded: [
        { name: "provider/cloudflare", reason: "collides with api-elysia" },
        { name: "provider/dockerfile", reason: "one provider per project" },
      ],
    });
  });

  test("installs the modules in the order it was given, not the order `bg list` printed", () => {
    const { modules } = selectModules(FULL_LISTING, ["tooling/vite-plus", "provider/cloudflare"], {
      "provider/dockerfile": "one provider per project",
    });
    expect(modules).toEqual(["tooling/vite-plus", "provider/cloudflare"]);
  });

  test("fails on a module that is neither installed nor excluded, and says what to do", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus"], { "provider/cloudflare": "x" }),
    ).toThrow(/provider\/dockerfile.*install.*exclude/s);
  });

  test("fails on an installed module that `bg list` does not show", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus", "tooling/ghost"], exclusions),
    ).toThrow(/tooling\/ghost/);
  });

  test("fails on an exclusion for a module the registry no longer lists", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus"], { ...exclusions, "auth/ghost": "gone" }),
    ).toThrow(/auth\/ghost/);
  });

  test("fails on a module that is both installed and excluded", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus", "provider/cloudflare"], exclusions),
    ).toThrow(/provider\/cloudflare.*both/s);
  });

  test("fails when nothing is installed, so a broken `bg list` is not a green run", () => {
    expect(() => selectModules(LISTING, [], {})).toThrow(/no modules/);
  });
});

describe("readAddedModules", () => {
  const output = JSON.stringify({
    dryRun: false,
    items: ["utils"],
    modules: [
      { module: "tooling/vite-plus", variant: "default", checks: ["bun run check"], files: [] },
      { module: "provider/cloudflare", variant: "default", files: [] },
    ],
    written: [],
  });

  test("reads each module's key and its checks, none when it declares none", () => {
    expect(readAddedModules(output, ["tooling/vite-plus"])).toEqual([
      { module: "tooling/vite-plus", checks: ["bun run check"] },
      { module: "provider/cloudflare", checks: [] },
    ]);
  });

  test("fails when `bg add` did not report a module golden asked for", () => {
    expect(() => readAddedModules(output, ["tooling/vite-plus", "db/d1"])).toThrow(/db\/d1/);
  });

  test("fails on output that is not the JSON `bg add` prints", () => {
    expect(() => readAddedModules("not json", [])).toThrow(/bg add/);
    expect(() => readAddedModules("{}", [])).toThrow(/modules/);
    expect(() => readAddedModules('{"modules":[{"module":"a/b","checks":[1]}]}', [])).toThrow(
      /checks/,
    );
  });
});

describe("the golden project and modules", () => {
  test("every module the registry lists is installed or left out with a reason", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.modules
      .map(({ manifest }) => `${manifest.category}/${manifest.id}\tmodule\t${manifest.description}`)
      .join("\n");

    const { modules } = selectModules(listing, MODULES, EXCLUDED_MODULES);

    expect(modules).toEqual(["tooling/vite-plus", "ui/shadcn"]);
  });

  test("leaves every provider out until stage 3: cloudflare collides with api-elysia's wrangler.jsonc", () => {
    expect(Object.keys(EXCLUDED_MODULES).sort()).toEqual([
      "provider/cloudflare",
      "provider/dockerfile",
    ]);
    expect(MODULES.some((name) => name.startsWith("provider/"))).toBe(false);
  });
});
