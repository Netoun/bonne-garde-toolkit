import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { createEmptyProjectManifest } from "@bonne-garde/schema";
import { loadLocalRegistry } from "./load-registry";
import { PlanError, resolveInstallPlan } from "./resolve-plan";
import type { RegistryItem } from "./types";

/**
 * The feature items (spec 030, 080): front-app source copied into `apps/<web>/src/features/**`,
 * which the consumer owns. They are tier 1, so everything a module would say in `module.json` or a
 * patch has to hold in the files themselves, and these tests are what says it does.
 */

const ROOT = join(import.meta.dir, "../../..");
const WEB_SPA_SRC = join(ROOT, "registry/modules/web/spa/template/apps/spa/src");
const TARGET = /^apps\/[^/]+\/src\/(features\/([^/]+)\/.+)$/;

async function featureItems(): Promise<RegistryItem[]> {
  const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
  return catalog.items.filter((item) =>
    (item.files ?? []).some((file) => TARGET.test(file.target ?? "")),
  );
}

type Source = { item: string; target: string; text: string };

async function sourcesOf(item: RegistryItem): Promise<Source[]> {
  return Promise.all(
    (item.files ?? []).map(async (file) => ({
      item: item.name,
      target: file.target ?? "",
      text: await readFile(file.path, "utf8"),
    })),
  );
}

const isTest = (target: string): boolean => /\.test\.tsx?$/.test(target);
const sorted = (names: Iterable<string>): string[] => [...new Set(names)].sort();

/** The specifiers a file imports or re-exports from. */
const specifiersOf = (source: string): string[] =>
  [...source.matchAll(/from\s+"([^"]+)"/g)].map(([, specifier = ""]) => specifier);

describe("the feature items (030)", () => {
  test("the catalog is the legacy spa features: auth, then everything behind the sign-in", async () => {
    expect((await featureItems()).map((item) => item.name)).toEqual(["spa-auth", "spa-backoffice"]);
  });

  test("every file exists, and lands in an app's features folder, with the type its folder says", async () => {
    const wrong: string[] = [];
    for (const item of await featureItems()) {
      for (const file of item.files ?? []) {
        const match = TARGET.exec(file.target ?? "");
        const folder = match?.[1]?.split("/")[2];
        const expected = isTest(file.target ?? "")
          ? "registry:file"
          : ({
              pages: "registry:page",
              components: "registry:component",
              hooks: "registry:hook",
              lib: "registry:lib",
            }[folder ?? ""] ?? "?");
        if (!existsSync(file.path) || file.type !== expected) {
          wrong.push(`${item.name}: ${file.path} as ${file.type} -> ${file.target}`);
        }
      }
    }
    expect(wrong).toEqual([]);
  });

  test("no file creates the host app: nothing outside src/features/ is written", async () => {
    const outside = (await featureItems()).flatMap((item) =>
      (item.files ?? [])
        .filter((file) => !TARGET.test(file.target ?? ""))
        .map((file) => `${item.name}: ${file.target}`),
    );
    expect(outside).toEqual([]);
  });

  describe("the route-module naming of the generated project's `structure/route-modules` rule", () => {
    test("a file in pages/ is named <feature>-…-page, -layout or -redirect, and none is anywhere else", async () => {
      const wrong: string[] = [];
      for (const item of await featureItems()) {
        for (const file of item.files ?? []) {
          const match = TARGET.exec(file.target ?? "");
          const [, relative = "", feature = ""] = match ?? [];
          const segments = relative.split("/");
          const name = segments.at(-1) ?? "";
          const inPages = segments.at(-2) === "pages";
          const routeShaped = /-(page|layout|redirect)\.tsx$/.test(name);
          if (isTest(name)) {
            continue;
          }
          if (inPages && !(routeShaped && name.startsWith(`${feature}-`))) {
            wrong.push(
              `${file.target}: a file in pages/ is <${feature}>-…-page|layout|redirect.tsx`,
            );
          }
          if (!inPages && routeShaped) {
            wrong.push(`${file.target}: -page/-layout/-redirect are reserved for routed files`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    test("no file sits at the root of a feature: it goes in components/, hooks/ or lib/", async () => {
      const loose = (await featureItems()).flatMap((item) =>
        (item.files ?? [])
          .filter((file) => (TARGET.exec(file.target ?? "")?.[1]?.split("/").length ?? 0) === 3)
          .map((file) => `${item.name}: ${file.target}`),
      );
      expect(loose).toEqual([]);
    });
  });

  test("an item declares exactly the items its files import: the UI items and the features it builds on", async () => {
    const items = await featureItems();
    const ownerOfFeature = new Map<string, string>();
    for (const item of items) {
      for (const file of item.files ?? []) {
        ownerOfFeature.set(TARGET.exec(file.target ?? "")?.[2] ?? "", item.name);
      }
    }

    const wrong: string[] = [];
    for (const item of items) {
      const imported = new Set<string>();
      for (const { target, text } of await sourcesOf(item)) {
        const own = TARGET.exec(target)?.[2] ?? "";
        for (const specifier of specifiersOf(text)) {
          const ui = /^@acme\/ui\/(?:components|lib|hooks)\/([^/]+)$/.exec(specifier)?.[1];
          const aliased = /^@acme\/spa\/features\/([^/]+)\//.exec(specifier)?.[1];
          const relative = specifier.startsWith(".")
            ? /^features\/([^/]+)\//.exec(
                posix.join(posix.dirname(target.replace(/^apps\/[^/]+\/src\//, "")), specifier),
              )?.[1]
            : undefined;
          const feature = aliased ?? relative;
          if (ui !== undefined) {
            imported.add(ui);
          } else if (feature !== undefined && feature !== own) {
            imported.add(ownerOfFeature.get(feature) ?? `?${feature}`);
          }
        }
      }
      imported.delete(item.name);
      const declared = sorted(item.registryDependencies ?? []);
      if (JSON.stringify(declared) !== JSON.stringify(sorted(imported))) {
        wrong.push(`${item.name}: declares [${declared}], imports [${sorted(imported)}]`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("an item lists the npm packages its files import, and its tests', in devDependencies", async () => {
    const wrong: string[] = [];
    for (const item of await featureItems()) {
      const imported = new Set<string>();
      const importedByTests = new Set<string>();
      for (const { target, text } of await sourcesOf(item)) {
        for (const specifier of specifiersOf(text)) {
          if (specifier.startsWith(".") || specifier.startsWith("@acme/")) {
            continue;
          }
          const [first = "", second = ""] = specifier.split("/");
          const name = first.startsWith("@") ? `${first}/${second}` : first;
          (isTest(target) ? importedByTests : imported).add(name);
        }
      }
      const declared = sorted(item.dependencies ?? []);
      const declaredDev = sorted(item.devDependencies ?? []);
      const expectedDev = sorted([...importedByTests].filter((name) => !imported.has(name)));
      if (JSON.stringify(declared) !== JSON.stringify(sorted(imported))) {
        wrong.push(`${item.name}: lists [${declared}], imports [${sorted(imported)}]`);
      }
      if (JSON.stringify(declaredDev) !== JSON.stringify(expectedDev)) {
        wrong.push(`${item.name}: devDependencies [${declaredDev}], tests import [${expectedDev}]`);
      }
    }
    expect(wrong).toEqual([]);
  });

  test("every `@acme/spa/<path>` a file imports is a file of the item, of another item or of the web/spa shell", async () => {
    const items = await featureItems();
    const shipped = new Set(
      items.flatMap((item) =>
        (item.files ?? []).map((file) => (file.target ?? "").replace(/^apps\/[^/]+\/src\//, "")),
      ),
    );
    const missing: string[] = [];
    for (const item of items) {
      for (const { target, text } of await sourcesOf(item)) {
        for (const specifier of specifiersOf(text)) {
          const path = /^@acme\/spa\/(.+)$/.exec(specifier)?.[1];
          if (path === undefined) {
            continue;
          }
          const found = [`${path}.ts`, `${path}.tsx`].some(
            (candidate) => shipped.has(candidate) || existsSync(join(WEB_SPA_SRC, candidate)),
          );
          if (!found) {
            missing.push(`${target} imports ${specifier}: no such file in the items or in web/spa`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("a relative import resolves to a file the item ships", async () => {
    const items = await featureItems();
    const shipped = new Set(
      items.flatMap((item) => (item.files ?? []).map((file) => file.target ?? "")),
    );
    const missing: string[] = [];
    for (const item of items) {
      for (const { target, text } of await sourcesOf(item)) {
        // `./+types/<route>` is what `react-router typegen` writes for a file `routes.ts` declares.
        const shipsOnlyWhenRouted = (name: string) => name.startsWith("./+types/");
        for (const specifier of specifiersOf(text).filter(
          (name) => name.startsWith(".") && !shipsOnlyWhenRouted(name),
        )) {
          const resolved = posix.join(posix.dirname(target), specifier);
          if (![`${resolved}.ts`, `${resolved}.tsx`].some((candidate) => shipped.has(candidate))) {
            missing.push(`${target} imports ${specifier}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });

  test("the front talks to Better Auth where the auth module serves it, and not at the legacy /auth", async () => {
    const [auth] = await featureItems();
    const client = (await sourcesOf(auth as RegistryItem)).find(({ target }) =>
      target.endsWith("/features/auth/lib/auth.ts"),
    );

    expect(client?.text).toContain('from "@acme/auth/client"');
    expect(client?.text).toContain("basePath: AUTH_BASE_PATH");
    expect(client?.text).not.toContain('"/auth"');
  });

  test("the dependency graph has no cycle, and spa-auth comes before what builds on it", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const manifest = createEmptyProjectManifest({ scope: "@acme", registries: {} });
    try {
      const plan = resolveInstallPlan(catalog, ["spa-backoffice"], manifest, [
        { category: "ui", id: "shadcn" },
        { category: "auth", id: "better-auth" },
      ]);
      const names = plan.items.map((item) => item.name);
      expect(names.indexOf("spa-auth")).toBeLessThan(names.indexOf("spa-backoffice"));
      expect(names.at(-1)).toBe("spa-backoffice");
    } catch (error) {
      if (error instanceof PlanError) {
        throw new Error(`the feature items do not resolve: ${error.message}`);
      }
      throw error;
    }
  });
});
