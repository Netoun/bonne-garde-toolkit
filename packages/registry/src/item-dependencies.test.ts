import { describe, expect, test } from "bun:test";
import { itemDependencyPatches } from "./item-dependencies";
import { PlanError } from "./resolve-plan";
import type { RegistryItem } from "./types";

/** An item whose files land at `targets`, with the dependency entries given. */
function item(
  targets: string[],
  dependencies: Pick<RegistryItem, "dependencies" | "devDependencies">,
): RegistryItem {
  return {
    name: "sign-in",
    type: "registry:block",
    ...dependencies,
    files: targets.map((target) => ({ path: target, type: "registry:file", target })),
  };
}

const IN_SPA = ["apps/spa/src/features/auth/lib/auth.ts", "apps/spa/src/features/auth/x.ts"];

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

describe("itemDependencyPatches (030): `name@version` entries are written, into the package its files land in", () => {
  test("is one package.dependencies patch on the app's package.json, with the versions as written", () => {
    expect(
      itemDependencyPatches(
        item(IN_SPA, {
          dependencies: ["better-auth@1.6.26", "zod@4.4.3"],
          devDependencies: ["vite-plus@0.2.8"],
        }),
        "@demo",
      ),
    ).toEqual([
      {
        type: "package.dependencies",
        file: "apps/spa/package.json",
        dependencies: { "better-auth": "1.6.26", zod: "4.4.3" },
        devDependencies: { "vite-plus": "0.2.8" },
      },
    ]);
  });

  test("renders the scope in the name of a workspace dependency, and keeps `workspace:*` as the version", () => {
    const [patch] = itemDependencyPatches(
      item(IN_SPA, { dependencies: ["@acme/auth@workspace:*"] }),
      "@demo",
    );

    expect(patch?.dependencies).toEqual({ "@demo/auth": "workspace:*" });
  });

  test("a bare name is what the files import and nothing writes: the host module pins it", () => {
    const patches = itemDependencyPatches(
      item(IN_SPA, { dependencies: ["react", "@tanstack/react-query", "zod@4.4.3"] }),
      "@demo",
    );

    expect(patches.map((patch) => patch.dependencies)).toEqual([{ zod: "4.4.3" }]);
    expect(
      itemDependencyPatches(item(IN_SPA, { dependencies: ["react", "@scope/pkg"] }), "@demo"),
    ).toEqual([]);
  });

  test("an item with no dependency, or none in devDependencies either, plans no patch", () => {
    expect(itemDependencyPatches(item(IN_SPA, {}), "@demo")).toEqual([]);
  });

  test("a UI item's files land in packages/ui: its package.json is where an entry would go", () => {
    const [patch] = itemDependencyPatches(
      item(["packages/ui/src/components/x.tsx"], { dependencies: ["motion@13.0.0"] }),
      "@demo",
    );

    expect(patch?.file).toBe("packages/ui/package.json");
  });

  test("files in two workspaces have no one package.json to write: refused, naming both", () => {
    expect(
      failure(() =>
        itemDependencyPatches(
          item([...IN_SPA, "packages/ui/src/components/x.tsx"], {
            dependencies: ["zod@4.4.3"],
          }),
          "@demo",
        ),
      ),
    ).toBe(
      "sign-in declares zod@4.4.3 but its files land in 2 workspaces (apps/spa, packages/ui): an entry with a version goes into one package.json",
    );
  });

  test("files outside any app or package have no package.json to write", () => {
    expect(
      failure(() =>
        itemDependencyPatches(item(["scripts/x.ts"], { dependencies: ["zod@4.4.3"] }), "@demo"),
      ),
    ).toBe(
      "sign-in declares zod@4.4.3 but its files land in no app or package (scripts/x.ts): an entry with a version goes into the package.json of one",
    );
  });

  test("an empty version, a package in both maps and a package twice are authoring errors", () => {
    expect(
      failure(() => itemDependencyPatches(item(IN_SPA, { dependencies: ["zod@"] }), "@demo")),
    ).toBe("sign-in declares dependencies entry zod@ with no version");
    expect(
      failure(() =>
        itemDependencyPatches(
          item(IN_SPA, { dependencies: ["zod@4.4.3"], devDependencies: ["zod@4.4.3"] }),
          "@demo",
        ),
      ),
    ).toBe("sign-in declares zod in dependencies and in devDependencies");
    expect(
      failure(() =>
        itemDependencyPatches(item(IN_SPA, { dependencies: ["zod@4.4.3", "zod@4.4.2"] }), "@demo"),
      ),
    ).toBe("sign-in declares zod twice in dependencies");
  });
});
