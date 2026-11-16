import { describe, expect, test } from "bun:test";
import { createEmptyProjectManifest, type ProjectManifest } from "@bonne-garde/schema";
import { PlanError, resolveInstallPlan, searchCatalog } from "./resolve-plan";
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

describe("searchCatalog", () => {
  test("filters by name", () => {
    expect(searchCatalog(catalog, "button").map((i) => i.name)).toEqual(["button"]);
  });
});

const FEATURE_ITEMS: RegistryCatalog = {
  ...catalog,
  items: [
    ...catalog.items,
    {
      name: "sign-in",
      type: "registry:block",
      registryDependencies: ["button"],
      meta: { needsModules: ["auth", "web/spa"] },
      files: [
        {
          path: "/tmp/sign-in.tsx",
          type: "registry:file",
          target: "apps/spa/src/features/auth/pages/auth-sign-in-page.tsx",
        },
      ],
    },
    {
      name: "uploads",
      type: "registry:block",
      meta: { needsModules: ["auth", "storage", "web/spa"] },
      files: [
        {
          path: "/tmp/uploads.tsx",
          type: "registry:file",
          target: "apps/spa/src/features/media/components/uploads.tsx",
        },
      ],
    },
    {
      // Declares nothing: a file in a features folder is not what says which modules an item needs.
      name: "welcome",
      type: "registry:block",
      files: [
        {
          path: "/tmp/welcome.tsx",
          type: "registry:file",
          target: "apps/ssr/src/features/home/components/welcome.tsx",
        },
      ],
    },
  ],
};

const BETTER_AUTH = { category: "auth", id: "better-auth" } as const;
const WEB_SPA = { category: "web", id: "spa" } as const;
const R2 = { category: "storage", id: "r2" } as const;

type Needed = { ui?: boolean; auth?: boolean; storage?: boolean; web?: string };

function record(id: string) {
  return {
    id,
    variant: "default",
    version: "0.1.0",
    installedAt: "2026-01-01T00:00:00.000Z",
    options: {},
    patches: [],
    intentions: { applied: [], skipped: {} },
  };
}

function projectWith(installed: Needed): ProjectManifest {
  const manifest = project(installed.ui === true);
  if (installed.auth === true) manifest.modules.auth = [record("better-auth")];
  if (installed.storage === true) manifest.modules.storage = [record("r2")];
  if (installed.web !== undefined) manifest.modules.web = [record(installed.web)];
  return manifest;
}

const ALL: Needed = { ui: true, auth: true, storage: true, web: "spa" };

describe("resolveInstallPlan: an item names the modules it needs, in meta.needsModules (030)", () => {
  test("a module the project lacks is refused by its category, or by its id when the item needs that one", () => {
    const message = failure(() =>
      resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], projectWith({ ui: true })),
    );

    expect(message).toBe(
      "sign-in needs the auth and web/spa modules, and none is installed or named in this call; run: bg add auth/better-auth web/spa sign-in",
    );
  });

  test("a project with none of them is told about every one at once, ui included", () => {
    const message = failure(() => resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], project()));

    expect(message).toBe(
      "sign-in needs the ui, auth and web/spa modules, and none is installed or named in this call; run: bg add ui/shadcn auth/better-auth web/spa sign-in",
    );
  });

  test("only the missing ones are named: the others are in bg.json", () => {
    expect(
      failure(() =>
        resolveInstallPlan(
          FEATURE_ITEMS,
          ["uploads"],
          projectWith({ ui: true, auth: true, web: "spa" }),
        ),
      ),
    ).toBe(
      "uploads needs the storage module, and none is installed or named in this call; run: bg add storage/r2 uploads",
    );
  });

  test("a module is named from the catalog when it lists one", () => {
    const listed = (category: "auth" | "storage", id: string) => ({
      dir: `/tmp/modules/${category}/${id}`,
      manifest: {
        id,
        category,
        title: id,
        description: "x",
        peers: {},
        variants: [{ key: "default", match: {} }],
      },
    });
    const withModules: RegistryCatalog = {
      ...FEATURE_ITEMS,
      modules: [listed("auth", "better-auth"), listed("auth", "lucia"), listed("storage", "s3")],
    };

    expect(
      failure(() => resolveInstallPlan(withModules, ["uploads"], projectWith({ ui: true }))),
    ).toBe(
      "uploads needs the auth, storage and web/spa modules, and none is installed or named in this call; run: bg add auth/better-auth or auth/lucia storage/s3 web/spa uploads",
    );
  });

  test("it passes when bg.json records every module", () => {
    const plan = resolveInstallPlan(FEATURE_ITEMS, ["uploads"], projectWith(ALL));

    expect(plan.items.map((i) => i.name)).toEqual(["uploads"]);
  });

  test("it passes when the modules are named in the same call", () => {
    const plan = resolveInstallPlan(FEATURE_ITEMS, ["uploads"], projectWith({ ui: true }), [
      BETTER_AUTH,
      R2,
      WEB_SPA,
    ]);

    expect(plan.items.map((i) => i.name)).toEqual(["uploads"]);
  });

  test("a category is met by any module of it", () => {
    const manifest = projectWith({ ui: true, web: "spa" });
    manifest.modules.auth = [record("lucia")];

    expect(resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], manifest).items).toHaveLength(3);
  });

  test("web/spa is not met by another web module: the item lands in apps/spa", () => {
    expect(
      failure(() =>
        resolveInstallPlan(
          FEATURE_ITEMS,
          ["sign-in"],
          projectWith({ ui: true, auth: true, web: "ssr" }),
        ),
      ),
    ).toBe(
      "sign-in needs the web/spa module, and none is installed or named in this call; run: bg add web/spa sign-in",
    );
    expect(
      failure(() =>
        resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], projectWith({ ui: true, auth: true }), [
          { category: "web", id: "ssr" },
        ]),
      ),
    ).toContain("web/spa");
  });

  test("another module named in the call does not stand in", () => {
    expect(() =>
      resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], projectWith({ ui: true }), [BETTER_AUTH]),
    ).toThrow(/web\/spa/);
  });

  test("a features folder is not what makes an item need a module: only meta.needsModules does", () => {
    expect(resolveInstallPlan(FEATURE_ITEMS, ["welcome"], project()).items).toHaveLength(1);
  });

  test("an item that needs both the ui module and others names every requested item that needs any", () => {
    const message = failure(() =>
      resolveInstallPlan(FEATURE_ITEMS, ["config", "button", "sign-in"], project()),
    );

    expect(message).toBe(
      "button, sign-in need the ui, auth and web/spa modules, and none is installed or named in this call; run: bg add ui/shadcn auth/better-auth web/spa config button sign-in",
    );
  });

  test("a need that is no category, or no <category>/<id>, is an authoring error that names the item", () => {
    const broken = (needsModules: unknown): RegistryCatalog => ({
      ...catalog,
      items: [{ name: "odd", type: "registry:block", meta: { needsModules } }],
    });

    expect(failure(() => resolveInstallPlan(broken(["authentication"]), ["odd"], project()))).toBe(
      'odd declares meta.needsModules "authentication": a module category (auth) or <category>/<id> (web/spa)',
    );
    expect(failure(() => resolveInstallPlan(broken(["web/"]), ["odd"], project()))).toContain(
      'meta.needsModules "web/"',
    );
    expect(failure(() => resolveInstallPlan(broken("auth"), ["odd"], project()))).toBe(
      "odd declares meta.needsModules that is not a list of strings",
    );
  });
});
