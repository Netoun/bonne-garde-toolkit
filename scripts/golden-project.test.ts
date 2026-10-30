import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { loadLocalRegistry } from "../packages/registry/src/index";
import {
  addArguments,
  CONFIGURATIONS,
  diffTrees,
  EXCLUDED,
  EXCLUDED_MODULES,
  expectPatches,
  expectRefusal,
  expectRegionsRecorded,
  MODULES,
  PATCHED,
  readAddedModules,
  SCOPE,
  selectItems,
  selectModules,
  type AddedModule,
} from "./golden-project";

const LISTING = [
  "utils\tregistry:lib\tcn() helper for className merging.",
  "button\tregistry:ui\tPrimary button component.",
  "portless\tregistry:lib\tNamed local HTTPS URLs.",
  "",
].join("\n");

describe("selectItems", () => {
  test("takes the first tab-separated column of every line", () => {
    expect(selectItems(LISTING, {})).toEqual({
      items: ["utils", "button", "portless"],
      excluded: [],
    });
  });

  test("keeps an excluded item out of the install list and reports why", () => {
    const { items, excluded } = selectItems(LISTING, { button: "needs a consumer app" });
    expect(items).toEqual(["utils", "portless"]);
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

    expect(selectItems(listing, EXCLUDED).items).toContain("button");
  });

  test("uses a scope that is not `@acme`'s length, which the registry is formatted with", () => {
    expect(SCOPE).toMatch(/^@[a-z0-9-]+$/);
    expect(SCOPE.length).not.toBe("@acme".length);
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
    "provider/cloudflare": "one provider per project",
    "provider/dockerfile": "one provider per project",
  };

  test("takes the module lines of `bg list` and skips the items", () => {
    expect(selectModules(FULL_LISTING, ["tooling/vite-plus"], exclusions)).toEqual({
      modules: ["tooling/vite-plus"],
      excluded: [
        { name: "provider/cloudflare", reason: "one provider per project" },
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
      { module: "tooling/vite-plus", checks: ["bun run check"], patches: [] },
      { module: "provider/cloudflare", checks: [], patches: [] },
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

    expect(modules).toEqual([
      "provider/cloudflare",
      "tooling/vite-plus",
      "config/branding",
      "ui/shadcn",
      "api/elysia",
      "web/spa",
      "provider/dockerfile",
    ]);
  });

  test("each configuration has one provider, and every provider the registry has is a configuration", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const providers = catalog.modules
      .filter(({ manifest }) => manifest.category === "provider")
      .map(({ manifest }) => `provider/${manifest.id}`);

    const used = CONFIGURATIONS.map(({ modules }) =>
      modules.filter((name) => name.startsWith("provider/")),
    );
    expect(used.every((names) => names.length === 1)).toBe(true);
    expect(used.flat().sort()).toEqual([...providers].sort());
    expect(Object.keys(EXCLUDED_MODULES)).toEqual([]);
  });

  test("only the configuration with a ui module installs items, which land in packages/ui", () => {
    for (const { modules, items } of CONFIGURATIONS) {
      if (items) {
        expect(modules).toContain("ui/shadcn");
      }
    }
    // The dockerfile configuration is a project with no SPA, which the Dockerfile has to build.
    expect(CONFIGURATIONS.find(({ name }) => name === "dockerfile")?.items).toBe(false);
  });
});

describe("addArguments", () => {
  test("is one `bg add`: the modules, then every item, with --yes and --no-install", () => {
    expect(addArguments(["tooling/vite-plus", "ui/shadcn"], ["utils", "button"])).toEqual([
      "add",
      "tooling/vite-plus",
      "ui/shadcn",
      "utils",
      "button",
      "--yes",
      "--no-install",
    ]);
  });

  test("never passes --force: a collision between two installs must fail the run", () => {
    expect(addArguments(MODULES, ["utils", "button"])).not.toContain("--force");
  });

  test("fails when a name is given twice, since a second mention hides a gap in a list", () => {
    expect(() => addArguments(["ui/shadcn"], ["button", "button"])).toThrow(/button/);
    expect(() => addArguments(["ui/shadcn"], ["ui/shadcn"])).toThrow(/ui\/shadcn/);
  });

  test("fails with no module, so an empty `bg list` is not a green run", () => {
    expect(() => addArguments([], ["button"])).toThrow(/no modules/);
  });

  test("takes no items, for a configuration that installs modules only; selectItems refuses an empty `bg list`", () => {
    expect(addArguments(["api/elysia"], [])).toEqual([
      "add",
      "api/elysia",
      "--yes",
      "--no-install",
    ]);
    expect(() => selectItems("", {})).toThrow(/no items/);
  });

  test("golden installs the ui module that every UI item needs, in the same call as the items", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.items.map((item) => `${item.name}\t${item.type}`).join("\n");

    const argv = addArguments(
      CONFIGURATIONS[0]?.modules ?? [],
      selectItems(listing, EXCLUDED).items,
    );

    expect(argv).toContain("ui/shadcn");
    expect(argv).toContain("button");
    expect(argv.indexOf("ui/shadcn")).toBeLessThan(argv.indexOf("button"));
  });
});

describe("expectRefusal", () => {
  const stderr =
    "button needs the ui module, and none is installed or named in this call; run: bg add ui/shadcn button\n";

  test("passes when the add failed and the message gives the command that fixes it", () => {
    expect(() => expectRefusal({ code: 1, stderr }, "button", "ui/shadcn")).not.toThrow();
  });

  test("fails when the add succeeded: an item with no host module must not install", () => {
    expect(() => expectRefusal({ code: 0, stderr: "" }, "button", "ui/shadcn")).toThrow(
      /succeeded/,
    );
  });

  test("fails when it was refused for another reason, and says what it printed", () => {
    expect(() =>
      expectRefusal({ code: 1, stderr: "unknown name: button\n" }, "button", "ui/shadcn"),
    ).toThrow(/bg add ui\/shadcn button.*unknown name: button/s);
  });
});

describe("readAddedModules: patches", () => {
  const patch = {
    type: "scripts.merge",
    file: "package.json",
    status: "applied",
    regions: [{ region: "scripts.gen:branding", status: "applied" }],
  };

  test("reads each patch with its status, reason and regions", () => {
    const output = JSON.stringify({
      modules: [
        { module: "config/branding", checks: [], patches: [patch] },
        {
          module: "x/y",
          patches: [{ ...patch, status: "failed", reason: "no file", regions: [] }],
        },
      ],
    });

    expect(readAddedModules(output, []).map(({ patches }) => patches)).toEqual([
      [patch],
      [
        {
          type: "scripts.merge",
          file: "package.json",
          status: "failed",
          reason: "no file",
          regions: [],
        },
      ],
    ]);
  });

  test("fails on a patch that is not what `bg add` prints", () => {
    expect(() =>
      readAddedModules(
        JSON.stringify({ modules: [{ module: "a/b", patches: [{ type: 1 }] }] }),
        [],
      ),
    ).toThrow(/patch/);
    expect(() =>
      readAddedModules(JSON.stringify({ modules: [{ module: "a/b", patches: "none" }] }), []),
    ).toThrow(/patches/);
  });
});

describe("expectPatches (060: a failed patch is never silent, and a re-add skips every one)", () => {
  const module = (
    status: string,
    regions: string[],
    more: Partial<AddedModule["patches"][number]> = {},
  ) => ({
    module: "config/branding",
    checks: [],
    patches: [
      {
        type: "scripts.merge",
        file: "package.json",
        status,
        regions: regions.map((region) => ({ region, status })),
        ...more,
      },
    ],
  });
  const expected = { "config/branding": ["scripts.gen:branding"] };

  test("passes when each module's patch did `status` to the regions golden expects", () => {
    expect(() =>
      expectPatches([module("applied", ["scripts.gen:branding"])], "applied", expected),
    ).not.toThrow();
    expect(() =>
      expectPatches([module("skipped", ["scripts.gen:branding"])], "skipped", expected),
    ).not.toThrow();
  });

  test("fails on a failed patch, with its reason", () => {
    expect(() =>
      expectPatches(
        [module("failed", [], { reason: "package.json does not exist" })],
        "applied",
        expected,
      ),
    ).toThrow(/failed.*package\.json does not exist/s);
  });

  test("fails when the status is not the one asked for, as an `applied` on a re-add", () => {
    expect(() =>
      expectPatches([module("applied", ["scripts.gen:branding"])], "skipped", expected),
    ).toThrow(/config\/branding.*applied.*skipped/s);
  });

  test("fails when a module that should patch reports none, or other regions", () => {
    expect(() =>
      expectPatches([{ module: "config/branding", checks: [], patches: [] }], "applied", expected),
    ).toThrow(/config\/branding.*scripts\.gen:branding/s);
    expect(() =>
      expectPatches([module("applied", ["scripts.other"])], "applied", expected),
    ).toThrow(/scripts\.other/);
  });

  test("fails on a patch from a module golden does not know patches", () => {
    expect(() =>
      expectPatches([module("applied", ["scripts.gen:branding"])], "applied", {}),
    ).toThrow(/config\/branding.*not.*PATCHED/s);
  });
});

describe("the golden project and patches", () => {
  test("PATCHED names, per configuration, the modules whose selected variant declares a patch, and the regions it writes", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );

    for (const { name, modules } of CONFIGURATIONS) {
      // What `bg add` does: among the variants whose `match` the configuration satisfies, the most specific.
      const regions: Record<string, string[]> = {};
      for (const { manifest } of catalog.modules) {
        if (!modules.includes(`${manifest.category}/${manifest.id}`)) {
          continue;
        }
        const satisfied = manifest.variants.filter((variant) =>
          Object.entries(variant.match).every(([category, id]) =>
            modules.includes(`${category}/${id}`),
          ),
        );
        const [variant] = satisfied.sort(
          (a, b) => Object.keys(b.match).length - Object.keys(a.match).length,
        );
        const written = (variant?.patch ?? []).flatMap((patch) =>
          Object.keys((patch.scripts as Record<string, string> | undefined) ?? {}).map(
            (script) => `scripts.${script}`,
          ),
        );
        if ((variant?.patch ?? []).length > 0) {
          regions[`${manifest.category}/${manifest.id}`] = written.sort();
        }
      }

      // A module that gains a patch is a decision made in golden, as a module that is not installed is.
      expect({ [name]: PATCHED[name] }).toEqual({ [name]: regions });
    }
    expect(Object.keys(PATCHED).sort()).toEqual(CONFIGURATIONS.map(({ name }) => name).sort());
    expect(PATCHED).toEqual({
      cloudflare: {
        "config/branding": ["scripts.gen:branding"],
        "api/elysia": ["scripts.deploy", "scripts.dev"],
        "web/spa": ["scripts.deploy", "scripts.dev"],
      },
      dockerfile: {
        "config/branding": ["scripts.gen:branding"],
        "api/elysia": ["scripts.dev"],
        "web/spa": ["scripts.dev"],
      },
    });
  });
});

describe("diffTrees (a re-add leaves the project the same bytes)", () => {
  const manifest = (installedAt: string, status: string) =>
    `{\n  "installedAt": "${installedAt}",\n  "patches": [{ "status": "${status}" }]\n}\n`;

  test("is empty for equal trees, and for a bg.json that moved only installedAt", () => {
    const before = { "a.ts": "x", "bg.json": manifest("2026-01-01T00:00:00.000Z", "applied") };
    const after = { "a.ts": "x", "bg.json": manifest("2026-01-02T00:00:00.000Z", "applied") };

    expect(diffTrees(before, after)).toEqual([]);
  });

  test("names a bg.json whose recorded patch status moved: a re-add must not flip it", () => {
    const before = { "bg.json": manifest("2026-01-01T00:00:00.000Z", "applied") };
    const after = { "bg.json": manifest("2026-01-01T00:00:00.000Z", "skipped") };

    expect(diffTrees(before, after)).toEqual(["bg.json changed"]);
  });

  test("names a changed, an added and a removed file", () => {
    expect(diffTrees({ a: "1", b: "1", c: "1" }, { a: "2", b: "1", d: "1" })).toEqual([
      "a changed",
      "c removed",
      "d added",
    ]);
  });

  test("names a bg.json that changed in anything else", () => {
    const before = { "bg.json": '{ "files": {} }' };

    expect(diffTrees(before, { "bg.json": '{ "files": { "a": 1 } }' })).toEqual([
      "bg.json changed",
    ]);
  });
});

describe("expectRegionsRecorded (bg.json carries what `bg add` reported)", () => {
  const added: AddedModule[] = [
    {
      module: "config/branding",
      checks: [],
      patches: [
        {
          type: "scripts.merge",
          file: "package.json",
          status: "applied",
          regions: [{ region: "scripts.gen:branding", status: "applied" }],
        },
      ],
    },
  ];

  test("passes when bg.json records each region for the module that reported it", () => {
    const manifest = { regions: { "package.json": { "scripts.gen:branding": "config/branding" } } };

    expect(() => expectRegionsRecorded(manifest, added)).not.toThrow();
  });

  test("fails when a region is missing from bg.json, or recorded for someone else", () => {
    expect(() => expectRegionsRecorded({ regions: {} }, added)).toThrow(
      /scripts\.gen:branding of package\.json/,
    );
    expect(() =>
      expectRegionsRecorded(
        { regions: { "package.json": { "scripts.gen:branding": "dev/other" } } },
        added,
      ),
    ).toThrow(/dev\/other/);
  });

  test("fails on a bg.json that is not an object with regions", () => {
    expect(() => expectRegionsRecorded("nope", added)).toThrow(/regions/);
  });
});
