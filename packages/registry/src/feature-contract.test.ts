import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, posix } from "node:path";
import { createEmptyProjectManifest } from "@bonne-garde/schema";
import { loadLocalRegistry } from "./load-registry";
import { PlanError, resolveInstallPlan } from "./resolve-plan";
import type { RegistryItem } from "./types";

/**
 * The feature items: front-app source copied into `apps/<web>/src/features/**`,
 * which the consumer owns. They are tier 1, so everything a module would say in `module.json` or a
 * patch has to hold in the files themselves, and these tests are what says it does.
 */

const ROOT = join(import.meta.dir, "../../..");
const WEB_SPA = join(ROOT, "registry/modules/web/spa");
const WEB_SPA_SRC = join(WEB_SPA, "template/apps/spa/src");
const TARGET = /^apps\/([^/]+)\/src\/(features\/([^/]+)\/.+)$/;
const FRAGMENT = /^features\/[^/]+\/routes\.ts$/;

async function featureItems(): Promise<RegistryItem[]> {
  const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
  return catalog.items.filter((item) =>
    (item.files ?? []).some((file) => TARGET.test(file.target ?? "")),
  );
}

type Source = { item: string; target: string; relative: string; text: string };

/** A file of an item with its path inside the app's `src`, which is how `routes.ts` and the imports name it. */
async function sourcesOf(item: RegistryItem): Promise<Source[]> {
  return Promise.all(
    (item.files ?? []).map(async (file) => ({
      item: item.name,
      target: file.target ?? "",
      relative: TARGET.exec(file.target ?? "")?.[2] ?? "",
      text: await readFile(file.path, "utf8"),
    })),
  );
}

/** A test, or a helper only tests import (MSW handlers, the render wrapper): none is app code, so none pulls a runtime dependency. */
const isTest = (target: string): boolean =>
  /(?:\.test\.tsx?|-msw-handlers\.ts|render-with-providers\.tsx)$/.test(target);
const isFragment = (relative: string): boolean => FRAGMENT.test(relative);
const sorted = (names: Iterable<string>): string[] => [...new Set(names)].sort();

/** The specifiers a file imports or re-exports from. */
const specifiersOf = (source: string): string[] =>
  [...source.matchAll(/from\s+"([^"]+)"/g)].map(([, specifier = ""]) => specifier);

/** `name`, `name@version`, `@scope/name@version`: a leading `@` is a scope, not a version. */
function splitSpec(spec: string): { name: string; version: string | null } {
  const at = spec.lastIndexOf("@");
  return at > 0
    ? { name: spec.slice(0, at), version: spec.slice(at + 1) }
    : { name: spec, version: null };
}

/** The route paths a fragment declares: the string literals that name a file under `features/`. */
const routedBy = (fragment: string): string[] =>
  [...fragment.matchAll(/["'`](features\/[^"'`]+\.tsx?)["'`]/g)].map(([, path = ""]) => path);

describe("the feature items", () => {
  test("the catalog is the legacy spa features: auth, then everything behind the sign-in", async () => {
    expect((await featureItems()).map((item) => item.name)).toEqual(["spa-auth", "spa-backoffice"]);
  });

  test("every file exists, and lands in an app's features folder, with the type its folder says", async () => {
    const wrong: string[] = [];
    for (const item of await featureItems()) {
      for (const file of item.files ?? []) {
        const [, , relative = "", feature = ""] = TARGET.exec(file.target ?? "") ?? [];
        const folder = relative.split("/")[2];
        const expected =
          isTest(file.target ?? "") || isFragment(relative)
            ? "registry:file"
            : ({
                pages: "registry:page",
                components: "registry:component",
                hooks: "registry:hook",
                lib: "registry:lib",
              }[folder ?? ""] ?? "?");
        if (!existsSync(file.path) || file.type !== expected || feature === "") {
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
        for (const { target, relative } of await sourcesOf(item)) {
          const segments = relative.split("/");
          const name = segments.at(-1) ?? "";
          const feature = segments[1] ?? "";
          const inPages = segments.at(-2) === "pages";
          const routeShaped = /-(page|layout|redirect)\.tsx$/.test(name);
          if (isTest(name)) {
            continue;
          }
          if (inPages && !(routeShaped && name.startsWith(`${feature}-`))) {
            wrong.push(`${target}: a file in pages/ is <${feature}>-…-page|layout|redirect.tsx`);
          }
          if (!inPages && routeShaped) {
            wrong.push(`${target}: -page/-layout/-redirect are reserved for routed files`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    test("no file sits at the root of a feature but its fragment: the rest goes in components/, hooks/ or lib/", async () => {
      const loose = (await featureItems()).flatMap((item) =>
        (item.files ?? [])
          .filter((file) => {
            const relative = TARGET.exec(file.target ?? "")?.[2] ?? "";
            return relative.split("/").length === 3 && !isFragment(relative);
          })
          .map((file) => `${item.name}: ${file.target}`),
      );
      expect(loose).toEqual([]);
    });
  });

  describe("the route fragments: `features/<feature>/routes.ts`, which web/spa's routes.ts composes", () => {
    test("each item ships one, in a feature folder of its own, and it is the only routes.ts it ships", async () => {
      for (const item of await featureItems()) {
        const sources = await sourcesOf(item);
        const fragments = sources.filter(({ relative }) => isFragment(relative));
        expect(fragments.map(({ target }) => target)).toHaveLength(1);
        const feature = fragments[0]?.relative.split("/")[1] ?? "";
        expect(
          sources.some(({ relative }) => relative.startsWith(`features/${feature}/pages/`)),
        ).toBe(true);
      }
    });

    test("it has the shape the lint rule reads: helpers called by their own name, imported from React Router's dev package, paths as string literals", async () => {
      const wrong: string[] = [];
      for (const item of await featureItems()) {
        for (const { target, relative, text } of await sourcesOf(item)) {
          if (!isFragment(relative)) {
            continue;
          }
          const imported = /import\s*\{([^}]*)\}\s*from\s*"@react-router\/dev\/routes"/.exec(
            text,
          )?.[1];
          if (imported === undefined) {
            wrong.push(`${target} imports nothing from "@react-router/dev/routes"`);
            continue;
          }
          const helpers = imported.split(",").map((name) => name.replace("type ", "").trim());
          const called = [...text.matchAll(/\b(route|layout|index)\(/g)].map(
            ([, name = ""]) => name,
          );
          const missing = sorted(called.filter((name) => !helpers.includes(name)));
          if (missing.length > 0 || called.length === 0) {
            wrong.push(
              `${target} calls ${sorted(called).join(", ") || "no helper"}, imports ${helpers.join(", ")}`,
            );
          }
          // Every helper call takes a literal path: no template, no variable (the rule reads strings).
          const calls = [...text.matchAll(/\b(?:route|layout|index)\(\s*([^,)\s]+)/g)].map(
            ([, argument = ""]) => argument,
          );
          const nonLiteral = calls.filter((argument) => !/^["']/.test(argument));
          if (nonLiteral.length > 0) {
            wrong.push(`${target}: ${nonLiteral.join(", ")} is not a string literal`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    test("it names files of its own item and no other, and every one exists: removing another item cannot leave it dangling", async () => {
      const dangling: string[] = [];
      for (const item of await featureItems()) {
        const sources = await sourcesOf(item);
        const own = new Set(sources.map(({ relative }) => relative));
        for (const { target, relative, text } of sources) {
          if (!isFragment(relative)) {
            continue;
          }
          for (const path of routedBy(text)) {
            if (!own.has(path)) {
              dangling.push(`${target} names ${path}, which ${item.name} does not ship`);
            }
          }
        }
      }
      expect(dangling).toEqual([]);
    });

    test("every route module an item ships is declared by its fragment, and nothing else is", async () => {
      const wrong: string[] = [];
      for (const item of await featureItems()) {
        const sources = await sourcesOf(item);
        const declared = new Set(
          sources
            .filter(({ relative }) => isFragment(relative))
            .flatMap(({ text }) => routedBy(text)),
        );
        const routeModules = sources
          .filter(({ relative }) => /-(page|layout|redirect)\.tsx$/.test(relative))
          .map(({ relative }) => relative);
        for (const relative of routeModules) {
          if (!declared.has(relative)) {
            wrong.push(`${item.name}: ${relative} is a route module the fragment does not declare`);
          }
        }
        for (const path of declared) {
          if (!routeModules.includes(path)) {
            wrong.push(`${item.name}: the fragment declares ${path}, which is not a route module`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    test("web/spa's routes.ts composes exactly those fragments: one glob of features/*/routes.ts, loaded eagerly", async () => {
      const composer = await readFile(join(WEB_SPA_SRC, "routes.ts"), "utf8");

      expect(composer).toContain("import.meta.glob<{ default: RouteConfigEntry[] }>(");
      expect(composer).toContain('"./features/*/routes.ts"');
      expect(composer).toContain("eager: true");
      // `features/**` would take a nested routes.ts for a fragment, which the lint rule does not.
      expect(composer).not.toContain("**");
    });
  });

  test("an item declares exactly the items its files import: the UI items and the features it builds on", async () => {
    const items = await featureItems();
    const ownerOfFeature = new Map<string, string>();
    for (const item of items) {
      for (const file of item.files ?? []) {
        ownerOfFeature.set(TARGET.exec(file.target ?? "")?.[3] ?? "", item.name);
      }
    }

    const wrong: string[] = [];
    for (const item of items) {
      const imported = new Set<string>();
      for (const { target, text } of await sourcesOf(item)) {
        const own = TARGET.exec(target)?.[3] ?? "";
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

  describe("the npm dependencies: `name@version` is written into the app's package.json, a bare name is the shell's", () => {
    /** The packages a file imports: `@scope/name` or `name`, subpaths folded; `@acme/ui` is the UI items', `@acme/spa` the app's own. */
    const packagesOf = (text: string): string[] =>
      sorted(
        specifiersOf(text).flatMap((specifier) => {
          if (specifier.startsWith(".")) {
            return [];
          }
          const [first = "", second = ""] = specifier.split("/");
          const name = first.startsWith("@") ? `${first}/${second}` : first;
          return name === "@acme/ui" || name === "@acme/spa" ? [] : [name];
        }),
      );

    test("an item lists the packages its files import, and the ones only its tests and fragments import in devDependencies", async () => {
      const wrong: string[] = [];
      for (const item of await featureItems()) {
        const imported = new Set<string>();
        const importedByTooling = new Set<string>();
        for (const { target, relative, text } of await sourcesOf(item)) {
          for (const name of packagesOf(text)) {
            (isTest(target) || isFragment(relative) ? importedByTooling : imported).add(name);
          }
        }
        const declared = sorted((item.dependencies ?? []).map((spec) => splitSpec(spec).name));
        const declaredDev = sorted(
          (item.devDependencies ?? []).map((spec) => splitSpec(spec).name),
        );
        const expectedDev = sorted([...importedByTooling].filter((name) => !imported.has(name)));
        if (JSON.stringify(declared) !== JSON.stringify(sorted(imported))) {
          wrong.push(`${item.name}: lists [${declared}], imports [${sorted(imported)}]`);
        }
        if (JSON.stringify(declaredDev) !== JSON.stringify(expectedDev)) {
          wrong.push(
            `${item.name}: devDependencies [${declaredDev}], tests and fragments import [${expectedDev}]`,
          );
        }
      }
      expect(wrong).toEqual([]);
    });

    /** What the cloudflare variant of web/spa pins, by name, with the scope as the items write it. */
    async function shellPins(): Promise<Map<string, string>> {
      const manifest = JSON.parse(await readFile(join(WEB_SPA, "module.json"), "utf8")) as {
        variants: {
          key: string;
          dependencies: Record<string, string>;
          devDependencies: Record<string, string>;
        }[];
      };
      const variant = manifest.variants.find(({ key }) => key === "cloudflare");
      return new Map(
        Object.entries({ ...variant?.dependencies, ...variant?.devDependencies }).map(
          ([name, version]) => [name.replace("{{SCOPE}}", "@acme"), version],
        ),
      );
    }

    test("a versioned entry is exact, and the shell does not pin it: the item is the only place that writes it", async () => {
      const pins = await shellPins();
      const wrong: string[] = [];
      for (const item of await featureItems()) {
        for (const spec of [...(item.dependencies ?? []), ...(item.devDependencies ?? [])]) {
          const { name, version } = splitSpec(spec);
          if (version === null) {
            continue;
          }
          if (version !== "workspace:*" && !/^\d+\.\d+\.\d+$/.test(version)) {
            wrong.push(`${item.name}: ${spec} is not an exact version`);
          }
          if (pins.has(name)) {
            wrong.push(`${item.name}: ${spec} is already pinned by web/spa at ${pins.get(name)}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    test("a bare entry is one the shell pins, so that nothing the files import is left for nobody to install", async () => {
      const pins = await shellPins();
      const unpinned: string[] = [];
      for (const item of await featureItems()) {
        for (const spec of [...(item.dependencies ?? []), ...(item.devDependencies ?? [])]) {
          const { name, version } = splitSpec(spec);
          if (version === null && !pins.has(name)) {
            unpinned.push(`${item.name}: ${name} has no version, and web/spa does not pin it`);
          }
        }
      }
      expect(unpinned).toEqual([]);
    });

    test("no package is written by two items: a region has one owner", async () => {
      const writers = new Map<string, string[]>();
      for (const item of await featureItems()) {
        for (const spec of [...(item.dependencies ?? []), ...(item.devDependencies ?? [])]) {
          const { name, version } = splitSpec(spec);
          if (version !== null) {
            writers.set(name, [...(writers.get(name) ?? []), item.name]);
          }
        }
      }
      expect([...writers].filter(([, items]) => items.length > 1)).toEqual([]);
    });

    test("the front's better-auth is the release the auth module's server runs: client and server skew is a bug", async () => {
      const auth = JSON.parse(
        await readFile(join(ROOT, "registry/modules/auth/better-auth/module.json"), "utf8"),
      ) as { variants: { dependencies: Record<string, string> }[] };
      const server = auth.variants[0]?.dependencies["better-auth"];
      const specs = (await featureItems()).flatMap((item) => item.dependencies ?? []);

      expect(specs).toContain(`better-auth@${server}`);
    });
  });

  describe("the modules an item needs, in meta.needsModules", () => {
    test("every feature item needs auth, and the web module that owns the app its files land in", async () => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const wrong: string[] = [];
      for (const item of await featureItems()) {
        const apps = sorted(
          (item.files ?? []).map((file) => `apps/${TARGET.exec(file.target ?? "")?.[1] ?? ""}`),
        );
        const needs = item.meta?.needsModules;
        if (!Array.isArray(needs) || !needs.includes("auth")) {
          wrong.push(`${item.name} does not need auth`);
        }
        for (const app of apps) {
          const owner = catalog.modules.find(
            ({ manifest }) =>
              manifest.category === "web" &&
              manifest.variants.some((variant) => variant.workspace?.path === app),
          )?.manifest.id;
          if (!Array.isArray(needs) || !needs.includes(`web/${owner}`)) {
            wrong.push(`${item.name} lands in ${app} and does not need web/${owner}`);
          }
        }
      }
      expect(wrong).toEqual([]);
    });

    test("spa-backoffice needs storage: its settings page uploads a logo through api.v1.media", async () => {
      const backoffice = (await featureItems()).find((item) => item.name === "spa-backoffice");
      const settings = (await sourcesOf(backoffice as RegistryItem)).find(({ target }) =>
        target.endsWith("organization-settings-page.tsx"),
      );

      expect(settings?.text).toContain("api.v1.media");
      expect(backoffice?.meta?.needsModules).toContain("storage");
    });

    test("every entry is a module of the catalog: a category it lists, or a <category>/<id> it ships", async () => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const known = new Set(
        catalog.modules.flatMap(({ manifest }) => [
          manifest.category,
          `${manifest.category}/${manifest.id}`,
        ]),
      );
      const unknown = (await featureItems()).flatMap((item) =>
        ((item.meta?.needsModules as string[] | undefined) ?? [])
          .filter((entry) => !known.has(entry))
          .map((entry) => `${item.name} needs ${entry}`),
      );
      expect(unknown).toEqual([]);
    });
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
          // `apps/<app>/testing/` (the MSW server) is the web/spa shell's.
          if (/^apps\/[^/]+\/testing\//.test(resolved) && isTest(target)) {
            continue;
          }
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

  test("the session guard is in the two layouts, and not in the shell's root.tsx, which stays auth-agnostic", async () => {
    const layouts = (await Promise.all((await featureItems()).map((item) => sourcesOf(item))))
      .flat()
      .filter(({ relative }) => relative.endsWith("-layout.tsx"));
    expect(layouts.map(({ relative }) => relative).sort()).toEqual([
      "features/auth/pages/auth-layout.tsx",
      "features/layout/pages/layout-app-layout.tsx",
    ]);
    for (const { text } of layouts) {
      expect(text).toContain("useAuthRedirect();");
    }
    const root = await readFile(join(WEB_SPA_SRC, "root.tsx"), "utf8");
    expect(root).not.toContain("useAuthRedirect");
    expect(root).not.toContain("useSession");
  });

  test("the dependency graph has no cycle, and spa-auth comes before what builds on it", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const manifest = createEmptyProjectManifest({ scope: "@acme", registries: {} });
    try {
      const plan = resolveInstallPlan(catalog, ["spa-backoffice"], manifest, [
        { category: "ui", id: "shadcn" },
        { category: "auth", id: "better-auth" },
        { category: "storage", id: "r2" },
        { category: "web", id: "spa" },
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
