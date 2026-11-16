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
      files: [
        {
          path: "/tmp/sign-in.tsx",
          type: "registry:file",
          target: "apps/spa/src/features/auth/pages/auth-sign-in-page.tsx",
        },
      ],
    },
    {
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

const BETTER_AUTH = [{ category: "auth", id: "better-auth" }] as const;

function projectWith(modules: { ui?: boolean; auth?: boolean }): ProjectManifest {
  const manifest = project(modules.ui === true);
  if (modules.auth === true) {
    manifest.modules.auth = [
      {
        id: "better-auth",
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

describe("resolveInstallPlan: an item that lands in apps/<app>/src/features needs the auth module (030)", () => {
  test("`bg add sign-in` in a project with ui and no auth fails, naming auth/better-auth and the command to run", () => {
    const message = failure(() =>
      resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], projectWith({ ui: true })),
    );

    expect(message).toBe(
      "sign-in needs the auth module, and none is installed or named in this call; run: bg add auth/better-auth sign-in",
    );
  });

  test("a project with neither module is told about both at once, not one after the other", () => {
    const message = failure(() => resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], project()));

    expect(message).toBe(
      "sign-in needs the ui and auth modules, and none is installed or named in this call; run: bg add ui/shadcn auth/better-auth sign-in",
    );
  });

  test("the module is named from the catalog when it lists one", () => {
    const withModule: RegistryCatalog = {
      ...FEATURE_ITEMS,
      modules: [
        {
          dir: "/tmp/modules/auth/better-auth",
          manifest: {
            id: "better-auth",
            category: "auth",
            title: "Better Auth",
            description: "x",
            peers: {},
            variants: [{ key: "default", match: {} }],
          },
        },
      ],
    };

    expect(
      failure(() => resolveInstallPlan(withModule, ["sign-in"], projectWith({ ui: true }))),
    ).toContain("bg add auth/better-auth sign-in");
  });

  test("it passes when bg.json records an auth module", () => {
    const plan = resolveInstallPlan(
      FEATURE_ITEMS,
      ["sign-in"],
      projectWith({ ui: true, auth: true }),
    );

    expect(plan.items.map((i) => i.name)).toEqual(["utils", "button", "sign-in"]);
  });

  test("it passes when an auth module is named in the same call", () => {
    const plan = resolveInstallPlan(
      FEATURE_ITEMS,
      ["sign-in"],
      projectWith({ ui: true }),
      BETTER_AUTH,
    );

    expect(plan.items.map((i) => i.name)).toEqual(["utils", "button", "sign-in"]);
  });

  test("another module named in the call does not stand in for it", () => {
    expect(() =>
      resolveInstallPlan(FEATURE_ITEMS, ["sign-in"], projectWith({ ui: true }), SHADCN),
    ).toThrow(/auth\/better-auth/);
  });

  test("any app's features folder counts, and the item needs nothing else", () => {
    expect(failure(() => resolveInstallPlan(FEATURE_ITEMS, ["welcome"], project()))).toBe(
      "welcome needs the auth module, and none is installed or named in this call; run: bg add auth/better-auth welcome",
    );
  });

  test("a file in an app's src outside features needs no auth module", () => {
    expect(
      resolveInstallPlan(FEATURE_ITEMS, ["shell"], projectWith({ ui: true })).items.map(
        (i) => i.name,
      ),
    ).toEqual(["config", "utils", "button", "shell"]);
  });

  test("an item that needs both names every requested item that needs either", () => {
    const message = failure(() =>
      resolveInstallPlan(FEATURE_ITEMS, ["config", "button", "sign-in"], project()),
    );

    expect(message).toBe(
      "button, sign-in need the ui and auth modules, and none is installed or named in this call; run: bg add ui/shadcn auth/better-auth config button sign-in",
    );
  });
});
