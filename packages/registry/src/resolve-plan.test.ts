import { describe, expect, test } from "bun:test";
import { createEmptyProjectManifest, type ProjectManifest } from "@bonne-garde/schema";
import { checkImportedModules, PlanError, resolveInstallPlan, searchCatalog } from "./resolve-plan";
import type { ModuleRef } from "./module-plan";
import type { RegistryCatalog } from "./types";

const catalog: RegistryCatalog = {
  name: "bg",
  rootDir: "/tmp",
  modules: [],
  items: [
    {
      name: "utils",
      type: "registry:lib",
      files: [
        {
          path: "/tmp/utils.ts",
          type: "registry:lib",
          target: "packages/ui/src/lib/utils.ts",
        },
      ],
    },
    {
      name: "button",
      type: "registry:ui",
      registryDependencies: ["utils"],
      files: [
        {
          path: "/tmp/button.tsx",
          type: "registry:ui",
          target: "packages/ui/src/components/button.tsx",
        },
      ],
    },
    {
      name: "card",
      type: "registry:ui",
      registryDependencies: ["utils"],
      files: [
        {
          path: "/tmp/card.tsx",
          type: "registry:ui",
          target: "packages/ui/src/components/card.tsx",
        },
      ],
    },
    {
      name: "config",
      type: "registry:lib",
      files: [
        { path: "/tmp/config.ts", type: "registry:lib", target: "packages/config/src/index.ts" },
      ],
    },
    {
      name: "shell",
      type: "registry:block",
      registryDependencies: ["config", "button"],
      files: [{ path: "/tmp/shell.ts", type: "registry:file", target: "apps/spa/src/shell.ts" }],
    },
    {
      // No `target`: where it lands is decided by its type, as `add` decides it.
      name: "untargeted",
      type: "registry:ui",
      files: [{ path: "/tmp/ui/untargeted.tsx", type: "registry:ui" }],
    },
    { name: "empty", type: "registry:block" },
  ],
};

function project(withUi = false): ProjectManifest {
  const manifest = createEmptyProjectManifest({ scope: "@acme", registries: {} });
  if (withUi) {
    manifest.modules.ui = [
      {
        id: "shadcn",
        variant: "default",
        version: "0.1.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        options: {},
        patches: [],
        intentions: { applied: [], skipped: {} },
      },
    ];
  }
  return manifest;
}

const SHADCN = [{ category: "ui", id: "shadcn" }] as const;

function failure(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof PlanError) {
      return error.message;
    }
    throw error;
  }
  throw new Error("expected a PlanError");
}

describe("resolveInstallPlan", () => {
  test("orders registryDependencies first", () => {
    const plan = resolveInstallPlan(catalog, ["button"], project(true));
    expect(plan.items.map((i) => i.name)).toEqual(["utils", "button"]);
  });

  test("the plan carries no capabilities and no transforms: meta.bg is gone", () => {
    const plan = resolveInstallPlan(catalog, ["button"], project(true));
    expect(Object.keys(plan).sort()).toEqual(["items", "npmDependencies", "npmDevDependencies"]);
  });

  test("skips an installed transitive dependency and re-includes a requested one", () => {
    const manifest = project(true);
    manifest.items.utils = {
      source: "@bg/utils",
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    };
    expect(resolveInstallPlan(catalog, ["button"], manifest).items.map((i) => i.name)).toEqual([
      "button",
    ]);
    expect(resolveInstallPlan(catalog, ["utils"], manifest).items.map((i) => i.name)).toEqual([
      "utils",
    ]);
  });

  test("fails on unknown item", () => {
    expect(() => resolveInstallPlan(catalog, ["nope"], project())).toThrow(PlanError);
  });

  test("fails on a circular registryDependencies", () => {
    const loop: RegistryCatalog = {
      ...catalog,
      items: [
        { name: "a", type: "registry:lib", registryDependencies: ["b"] },
        { name: "b", type: "registry:lib", registryDependencies: ["a"] },
      ],
    };
    expect(() => resolveInstallPlan(loop, ["a"], project())).toThrow(/circular/);
  });
});

describe("resolveInstallPlan: an item that lands in packages/ui needs the ui module (030)", () => {
  test("`bg add button` in a fresh project fails, naming ui/shadcn and the command to run", () => {
    const message = failure(() => resolveInstallPlan(catalog, ["button"], project()));

    expect(message).toBe(
      "button needs the ui module, and none is installed or named in this call; run: bg add ui/shadcn button",
    );
  });

  test("the module is named from the catalog when it lists one", () => {
    const withModule: RegistryCatalog = {
      ...catalog,
      modules: [
        {
          dir: "/tmp/modules/ui/shadcn",
          manifest: {
            id: "shadcn",
            category: "ui",
            title: "shadcn/ui",
            description: "x",
            peers: {},
            variants: [{ key: "default", match: {} }],
          },
        },
      ],
    };

    expect(failure(() => resolveInstallPlan(withModule, ["card"], project()))).toContain(
      "bg add ui/shadcn card",
    );
  });

  test("it passes when bg.json records a ui module", () => {
    expect(resolveInstallPlan(catalog, ["button"], project(true)).items).toHaveLength(2);
  });

  test("it passes when a ui module is named in the same call", () => {
    const plan = resolveInstallPlan(catalog, ["button"], project(), SHADCN);

    expect(plan.items.map((i) => i.name)).toEqual(["utils", "button"]);
  });

  test("another module named in the call does not stand in for it", () => {
    expect(() =>
      resolveInstallPlan(catalog, ["button"], project(), [
        { category: "provider", id: "cloudflare" },
      ]),
    ).toThrow(/ui\/shadcn/);
  });

  test("an item whose dependency lands there needs it too, and is the one named", () => {
    const message = failure(() => resolveInstallPlan(catalog, ["shell"], project()));

    expect(message).toStartWith("shell needs the ui module");
    expect(message).toEndWith("bg add ui/shadcn shell");
  });

  test("an item with no file under packages/ui, and none in its dependencies, needs nothing", () => {
    expect(resolveInstallPlan(catalog, ["config"], project()).items.map((i) => i.name)).toEqual([
      "config",
    ]);
    expect(resolveInstallPlan(catalog, ["empty"], project()).items.map((i) => i.name)).toEqual([
      "empty",
    ]);
  });

  test("it names the requested items that need the module, and keeps every requested name in the command", () => {
    const message = failure(() =>
      resolveInstallPlan(catalog, ["config", "button", "card"], project()),
    );

    expect(message).toBe(
      "button, card need the ui module, and none is installed or named in this call; run: bg add ui/shadcn config button card",
    );
  });

  test("a file with no target lands where `add` puts a registry:ui item", () => {
    expect(failure(() => resolveInstallPlan(catalog, ["untargeted"], project()))).toContain(
      "untargeted needs the ui module",
    );
  });

  test("an installed item is checked too: bg.json without a ui module is not a ui project", () => {
    const manifest = project();
    manifest.items.button = {
      source: "@bg/button",
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    };

    expect(() => resolveInstallPlan(catalog, ["button"], manifest)).toThrow(/ui\/shadcn/);
  });
});

describe("checkImportedModules: an item that imports a module's package needs the module", () => {
  const importing = (name: string, content: string, registryDependencies: string[] = []) => ({
    name,
    type: "registry:block",
    registryDependencies,
    files: [
      {
        path: `/tmp/${name}.tsx`,
        type: "registry:file",
        target: `apps/spa/src/${name}.tsx`,
        content,
      },
    ],
  });
  const withImports: RegistryCatalog = {
    ...catalog,
    items: [
      importing("brand", 'import { branding } from "@acme/config";\n'),
      importing("brand-sub", "import { x } from '@acme/config/branding';\n"),
      importing("manifest", '{ "dependencies": { "@acme/config": "workspace:*" } }\n'),
      importing("plain", 'import { x } from "@acme/ui/lib/utils";\n'),
      importing("lookalike", 'import { x } from "@acme/config-extra";\n'),
      importing("page", "export {};\n", ["brand"]),
    ],
  };
  const plan = (...names: string[]) => resolveInstallPlan(withImports, names, project());
  const check = (names: string[], manifest = project(), modules: readonly ModuleRef[] = []) =>
    checkImportedModules(withImports, names, plan(...names), manifest, modules);
  const rejection = async (run: () => Promise<void>): Promise<string> =>
    run().then(
      () => "",
      (error: unknown) => (error instanceof PlanError ? error.message : String(error)),
    );

  test("an item importing @acme/config fails, naming the module and the command to run", async () => {
    expect(await rejection(() => check(["brand"]))).toBe(
      "brand needs the config module, and none is installed or named in this call; run: bg add config/branding brand",
    );
  });

  test("a subpath import and a workspace dependency count too", async () => {
    expect(await rejection(() => check(["brand-sub"]))).toStartWith(
      "brand-sub needs the config module",
    );
    expect(await rejection(() => check(["manifest"]))).toStartWith(
      "manifest needs the config module",
    );
  });

  test("an item importing another package, or a package whose name merely starts the same, needs nothing", async () => {
    await check(["plain"]);
    await check(["lookalike"]);
  });

  test("the requested item whose dependency imports it is the one named", async () => {
    expect(await rejection(() => check(["page"]))).toStartWith("page needs the config module");
  });

  test("it passes when bg.json records a config module, or the call names one", async () => {
    const installed = project();
    installed.modules.config = [
      {
        id: "branding",
        variant: "default",
        version: "0.0.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        options: {},
        patches: [],
        intentions: { applied: [], skipped: {} },
      },
    ];
    await check(["brand"], installed);
    await check(["brand"], project(), [{ category: "config", id: "branding" }]);
  });

  test("another module in the call does not stand in for it", async () => {
    // The command keeps the module the caller named: running it must not drop it.
    expect(await rejection(() => check(["brand"], project(), SHADCN))).toEndWith(
      "run: bg add config/branding ui/shadcn brand",
    );
  });

  test("the module is named from the catalog when it lists one", async () => {
    const listing: RegistryCatalog = {
      ...withImports,
      modules: [
        {
          dir: "/tmp/modules/config/other",
          manifest: {
            id: "other",
            category: "config",
            title: "Other",
            description: "x",
            peers: {},
            variants: [{ key: "default", match: {} }],
          },
        },
      ],
    };

    const message = await rejection(() =>
      checkImportedModules(listing, ["brand"], plan("brand"), project(), []),
    );

    expect(message).toContain("bg add config/other brand");
  });
});

describe("searchCatalog", () => {
  test("filters by name", () => {
    expect(searchCatalog(catalog, "button").map((i) => i.name)).toEqual(["button"]);
  });
});
