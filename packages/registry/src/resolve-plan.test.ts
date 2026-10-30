import { describe, expect, test } from "bun:test";
import { createEmptyProjectManifest } from "@bonne-garde/schema";
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

  test("takes the capabilities of already-installed items from the catalog", () => {
    const manifest = createEmptyProjectManifest({ scope: "@acme", registries: {} });
    manifest.items.utils = {
      source: "@bg/utils",
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    };
    // `utils` is skipped as already installed, so `button`'s `ui-utils` requirement can only be
    // met by what the recorded item provides.
    const plan = resolveInstallPlan(catalog, ["button"], manifest);
    expect(plan.items.map((i) => i.name)).toEqual(["button"]);
    expect(plan.capabilities).toEqual(["ui", "ui-utils"]);
  });

  test("an installed item that left the catalog provides nothing", () => {
    const manifest = createEmptyProjectManifest({ scope: "@acme", registries: {} });
    manifest.items.utils = {
      source: "@bg/utils",
      version: "0.0.0",
      installedAt: "2026-01-01T00:00:00.000Z",
    };
    const withoutUtils: RegistryCatalog = {
      ...catalog,
      items: catalog.items
        .filter((i) => i.name !== "utils")
        .map((i) => ({
          ...i,
          registryDependencies: [],
        })),
    };
    expect(() => resolveInstallPlan(withoutUtils, ["button"], manifest)).toThrow(
      /requires capability ui-utils/,
    );
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
