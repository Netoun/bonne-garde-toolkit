import { describe, expect, test } from "bun:test";
import { createEmptyProjectManifest } from "@bonne-garde/schema";
import { PlanError, resolveInstallPlan, searchCatalog } from "./resolve-plan";
import type { RegistryCatalog } from "./types";

const catalog: RegistryCatalog = {
  name: "bg",
  rootDir: "/tmp",
  items: [
    {
      name: "utils",
      type: "registry:lib",
      files: [{ path: "/tmp/utils.ts", type: "registry:lib" }],
      meta: { bg: { provides: ["ui-utils"] } },
    },
    {
      name: "button",
      type: "registry:ui",
      registryDependencies: ["utils"],
      files: [{ path: "/tmp/button.tsx", type: "registry:ui" }],
      meta: { bg: { provides: ["ui"], requires: ["ui-utils"] } },
    },
    {
      name: "api-elysia",
      type: "registry:block",
      meta: { bg: { provides: ["api"], conflicts: ["api-other"] } },
    },
  ],
};

describe("resolveInstallPlan", () => {
  test("orders registryDependencies first", () => {
    const plan = resolveInstallPlan(
      catalog,
      ["button"],
      createEmptyProjectManifest({ scope: "@acme", registries: {} }),
    );
    expect(plan.items.map((i) => i.name)).toEqual(["utils", "button"]);
    expect(plan.capabilities).toContain("ui");
  });

  test("fails on unknown item", () => {
    expect(() =>
      resolveInstallPlan(
        catalog,
        ["nope"],
        createEmptyProjectManifest({ scope: "@acme", registries: {} }),
      ),
    ).toThrow(PlanError);
  });
});

describe("searchCatalog", () => {
  test("filters by name", () => {
    expect(searchCatalog(catalog, "button").map((i) => i.name)).toEqual(["button"]);
  });
});
