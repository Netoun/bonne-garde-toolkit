import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { isModuleCategory, parseModuleManifest } from "@bonne-garde/schema";
import {
  assertBranding,
  renderBrandingModule,
} from "../../../registry/modules/config/branding/template/packages/config/src/gen-branding";
import { loadLocalRegistry } from "./load-registry";
import { plannedPatches } from "./patch-plan";

const ROOT = join(import.meta.dir, "../../..");
const MODULES = join(ROOT, "registry/modules");

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every `registry/modules/<category>/<id>/module.json`, as [category, id, absolute path]. */
async function findModuleManifests(): Promise<[string, string, string][]> {
  if (!existsSync(MODULES)) return [];
  const found: [string, string, string][] = [];
  for (const category of await readdir(MODULES, { withFileTypes: true })) {
    if (!category.isDirectory()) continue;
    const categoryDir = join(MODULES, category.name);
    for (const module of await readdir(categoryDir, { withFileTypes: true })) {
      if (!module.isDirectory()) continue;
      const manifest = join(categoryDir, module.name, "module.json");
      if (existsSync(manifest)) {
        found.push([category.name, module.name, manifest]);
      }
    }
  }
  return found.sort((a, b) => a[2].localeCompare(b[2]));
}

/** The packages a file imports from, as `react`, `@base-ui/react`, `motion`: subpaths folded away. */
const packagesImportedBy = (source: string): string[] =>
  [...source.matchAll(/from\s+"([^".][^"]*)"/g)].flatMap(([, specifier]) => {
    if (specifier === undefined) {
      return [];
    }
    const [scope, name] = specifier.split("/");
    return [
      specifier.startsWith("@") || specifier.startsWith("{")
        ? `${scope}/${name}`
        : (scope ?? specifier),
    ];
  });

/** Whether `subpath` (`./lib/eden`) is served by the `exports` key `pattern` (`./lib/*`). */
const exportMatches = (pattern: string, subpath: string): boolean => {
  const star = pattern.indexOf("*");
  return star === -1
    ? pattern === subpath
    : subpath.startsWith(pattern.slice(0, star)) && subpath.endsWith(pattern.slice(star + 1));
};

describe("module contract", () => {
  test("every module.json parses, and its path agrees with its contents", async () => {
    const manifests = await findModuleManifests();

    // Spec 035 defines the native format; the first modules written to it are the two providers.
    expect(manifests.length).toBeGreaterThan(0);

    for (const [categoryDir, moduleDir, path] of manifests) {
      expect(isModuleCategory(categoryDir)).toBe(true);

      const manifest = parseModuleManifest(JSON.parse(await readFile(path, "utf8")));

      // The path is the identity: spec 035 puts a module at registry/modules/<category>/<id>/.
      expect<string>(manifest.category).toBe(categoryDir);
      expect(manifest.id).toBe(moduleDir);
    }
  });

  test("a module's copy globs stay out of an app's src, unless the module is that app", async () => {
    // Spec 035, package-dedicated seam: "MUST NOT write module source directly into apps/*/src".
    // An app-homed module is the app it fills (`api` is `apps/api`, `web/<id>` is `apps/<id>`): its
    // source lives there, and it writes nowhere else. Every other module stays out of every app.
    const appHome = (category: string, id: string): string | null =>
      category === "api" ? "apps/api" : category === "web" ? `apps/${id}` : null;
    const offending: string[] = [];
    for (const [category, id, path] of await findModuleManifests()) {
      const manifest = parseModuleManifest(JSON.parse(await readFile(path, "utf8")));
      const home = appHome(category, id);
      for (const variant of manifest.variants) {
        for (const glob of variant.copy ?? []) {
          const outside =
            home === null ? /^apps\/[^/]+\/src\//.test(glob) : !glob.startsWith(`${home}/`);
          if (outside) {
            offending.push(`${category}/${id} ${variant.key}: ${glob}`);
          }
        }
      }
    }
    expect(offending).toEqual([]);
  });

  test("both providers exist and peer on nothing", async () => {
    const ids = new Set<string>();
    for (const [category, id, path] of await findModuleManifests()) {
      if (category !== "provider") continue;
      ids.add(id);
      const manifest = parseModuleManifest(JSON.parse(await readFile(path, "utf8")));
      // `provider` is first in the topological order, so it has no peers by construction.
      expect(manifest.peers).toEqual({});
    }

    expect(ids).toEqual(new Set(["cloudflare", "dockerfile"]));
  });

  describe("a provider owns packages/api-runtime whole and writes nothing under apps/ (035 provider note, seam rule)", () => {
    const providers = async () => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      return catalog.modules.filter(({ manifest }) => manifest.category === "provider");
    };

    test("no variant of a provider copies a path under apps/", async () => {
      const found = await providers();
      expect(found.length).toBeGreaterThan(0);
      const under: string[] = [];
      for (const { manifest } of found) {
        for (const variant of manifest.variants) {
          for (const path of variant.copy ?? []) {
            if (path.startsWith("apps/")) {
              under.push(`provider/${manifest.id} ${variant.key}: ${path}`);
            }
          }
        }
      }
      expect(under).toEqual([]);
    });

    test("each one writes the package from explicit paths, as the workspace `{{SCOPE}}/api-runtime`", async () => {
      for (const { manifest } of await providers()) {
        const [variant, ...others] = manifest.variants;
        expect(others).toEqual([]);
        expect(variant?.workspace).toEqual({
          name: "{{SCOPE}}/api-runtime",
          path: "packages/api-runtime",
        });
        expect(variant?.copy?.filter((path) => /[*?[\]{}]/.test(path))).toEqual([]);
        for (const path of [
          "packages/api-runtime/package.json",
          "packages/api-runtime/tsconfig.json",
          "packages/api-runtime/src/index.ts",
          "packages/api-runtime/src/index.test.ts",
        ]) {
          expect(variant?.copy).toContain(path);
        }
        // Spec 035 declares a dependency once: `elysia` is the variant's, pinned the same everywhere.
        expect(variant?.dependencies).toEqual({ elysia: "1.4.29" });
      }
    });

    test("each package.json carries exports and the typecheck and test scripts, and no dependency map", async () => {
      for (const { manifest, dir } of await providers()) {
        const body: unknown = JSON.parse(
          await readFile(join(dir, "template/packages/api-runtime/package.json"), "utf8"),
        );
        expect(body).toMatchObject({
          name: "{{SCOPE}}/api-runtime",
          exports: { ".": "./src/index.ts" },
          scripts: { typecheck: expect.any(String), test: "bun test" },
        });
        for (const map of ["dependencies", "devDependencies", "peerDependencies"]) {
          expect(isRecord(body) && map in body ? `${manifest.id}: ${map}` : null).toBeNull();
        }
      }
    });

    test("each index.ts exports the three names `api` imports, whatever the provider", async () => {
      for (const { manifest, dir } of await providers()) {
        const source = await readFile(
          join(dir, "template/packages/api-runtime/src/index.ts"),
          "utf8",
        );
        for (const name of ["runtimeOptions", "readRuntimeEnv", "serve"]) {
          expect(`${manifest.id}: ${source}`).toMatch(
            new RegExp(`export (?:const|async function|function) ${name}\\b`),
          );
        }
      }
    });
  });

  test("tooling/vite-plus is the quality gate: the Vite+ config and the pre-commit hook, no dependencies", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const found = catalog.modules.find(
      ({ manifest }) => manifest.category === "tooling" && manifest.id === "vite-plus",
    );
    if (!found) {
      throw new Error("registry/modules/tooling/vite-plus is missing");
    }
    const { manifest } = found;

    expect(manifest.peers).toEqual({});
    expect(manifest.checks).toEqual(["bun run check"]);
    expect(manifest.variants).toHaveLength(1);
    const [variant] = manifest.variants;
    expect(variant?.match).toEqual({});
    expect(variant?.copy).toEqual(["vite.config.ts", ".husky/pre-commit"]);
    // A repo-homed module needs an explicit `workspace` to declare dependencies, and `vite-plus` and
    // `husky` already come with the base template, so there is nothing for it to write into.
    expect(variant?.workspace).toBeUndefined();
    expect(variant?.dependencies ?? {}).toEqual({});
    expect(variant?.devDependencies ?? {}).toEqual({});
    expect(variant?.patch ?? []).toEqual([]);

    expect(await readFile(join(found.dir, "template/.husky/pre-commit"), "utf8")).toBe(
      "bunx vp staged\n",
    );
  });

  test("tooling/vite-plus lints React code at the homes 035 fixes, and the server app as server code", async () => {
    const config: unknown = (
      await import(join(MODULES, "tooling/vite-plus/template/vite.config.ts"))
    ).default;
    const lint = isRecord(config) ? config.lint : undefined;
    const overrides = isRecord(lint) && Array.isArray(lint.overrides) ? lint.overrides : [];
    const named = (file: string) =>
      overrides.filter(
        (entry): entry is Record<string, unknown> =>
          isRecord(entry) && Array.isArray(entry.files) && entry.files.includes(file),
      );

    // `web` modules write `apps/<id>`, the UI items write `packages/ui`: ids are free, homes are not.
    for (const home of ["apps/*/**", "packages/ui/**"]) {
      const [react, ...others] = named(home);
      expect(others).toEqual([]);
      expect(react?.plugins).toContain("react");
      expect(react?.env).toMatchObject({ browser: true });
      expect(react?.excludeFiles).toEqual(["apps/api/**"]);
      // Enabling a plugin in an override switches none of its rules on, and a rule left at its
      // default is `warn`, which `vp check` passes: a violation only fails when the rule is named.
      expect(react?.rules).toMatchObject({ "react/jsx-key": "error" });
    }

    // `config/branding` ships a generator script at 035's fixed home for that package, and it prints.
    for (const home of ["apps/api/**", "scripts/**", "packages/config/scripts/**"]) {
      const [server, ...others] = named(home);
      expect(others).toEqual([]);
      expect(server?.rules).toEqual({ "no-console": "off" });
    }
  });

  test("every dependency a variant declares is an exact version (035: exact version maps)", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const loose: string[] = [];

    for (const { manifest } of catalog.modules) {
      for (const variant of manifest.variants) {
        for (const map of [variant.dependencies ?? {}, variant.devDependencies ?? {}]) {
          for (const [name, version] of Object.entries(map)) {
            // `workspace:*` is how a module names a sibling package of the project (`{{SCOPE}}/<name>`).
            const sibling = name.startsWith("{{SCOPE}}/") && version === "workspace:*";
            if (!sibling && !/^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)) {
              loose.push(`${manifest.category}/${manifest.id} ${variant.key}: ${name}@${version}`);
            }
          }
        }
      }
    }

    expect(loose).toEqual([]);
  });

  describe("ui/shadcn is the host package of the UI items (030, 035)", () => {
    const uiModule = async () => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const found = catalog.modules.find(
        ({ manifest }) => manifest.category === "ui" && manifest.id === "shadcn",
      );
      if (!found) {
        throw new Error("registry/modules/ui/shadcn is missing");
      }
      const [variant] = found.manifest.variants;
      if (!variant) {
        throw new Error("ui/shadcn has no variant");
      }
      return { ...found, variant };
    };

    /** 030: the rule is keyed on where the files land, not on a field. */
    const landsInPackagesUi = (item: { files?: { target?: string }[] }): boolean =>
      (item.files ?? []).some((file) => file.target?.startsWith("packages/ui/") === true);

    test("it writes packages/ui from explicit paths, and `{{SCOPE}}/ui` is its workspace", async () => {
      const { manifest, variant } = await uiModule();

      expect(manifest.peers).toEqual({});
      expect(variant.match).toEqual({});
      expect(variant.workspace).toEqual({ name: "{{SCOPE}}/ui", path: "packages/ui" });
      // A glob cannot be expanded over `github:`, which has no directory listing.
      expect(variant.copy?.filter((path) => /[*?[\]{}]/.test(path))).toEqual([]);
      expect(variant.copy).toEqual([
        "packages/ui/package.json",
        "packages/ui/tsconfig.json",
        "packages/ui/components.json",
        "packages/ui/src/env.d.ts",
        "packages/ui/src/styles/globals.css",
        "packages/ui/src/styles/themes/default.css",
      ]);
      expect(manifest.checks).toEqual(["bun run typecheck"]);
      expect(variant.patch ?? []).toEqual([]);
      expect(variant.intent ?? []).toEqual([]);
    });

    test("its package.json carries exports and scripts and no dependency map (the variant has them)", async () => {
      const { dir } = await uiModule();
      const body: unknown = JSON.parse(
        await readFile(join(dir, "template/packages/ui/package.json"), "utf8"),
      );

      expect(body).toMatchObject({
        name: "{{SCOPE}}/ui",
        exports: {
          "./components/*": "./src/components/*.tsx",
          "./globals.css": "./src/styles/globals.css",
          "./hooks/*": "./src/hooks/*.ts",
          "./lib/*": "./src/lib/*.ts",
          "./themes/default.css": "./src/styles/themes/default.css",
        },
        scripts: { typecheck: "tsc --noEmit" },
      });
      for (const map of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        expect(body).not.toHaveProperty(map);
      }
    });

    test("every package a UI item imports is declared by the variant", async () => {
      const { variant } = await uiModule();
      const declared = new Set([
        ...Object.keys(variant.dependencies ?? {}),
        ...Object.keys(variant.devDependencies ?? {}),
      ]);
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const missing: string[] = [];

      for (const item of catalog.items.filter(landsInPackagesUi)) {
        for (const file of item.files ?? []) {
          if (!/\.tsx?$/.test(file.path)) {
            continue;
          }
          for (const name of packagesImportedBy(await readFile(file.path, "utf8"))) {
            // `@acme/ui/...` is the host package itself, checked below.
            if (name !== "@acme/ui" && !declared.has(name)) {
              missing.push(`${item.name}: ${name}`);
            }
          }
        }
      }

      expect(missing).toEqual([]);
    });

    test("every `@acme/ui/<subpath>` a UI item imports is an export of the package", async () => {
      const { dir } = await uiModule();
      const { exports }: { exports: Record<string, string> } = JSON.parse(
        await readFile(join(dir, "template/packages/ui/package.json"), "utf8"),
      );
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const unreachable: string[] = [];

      for (const item of catalog.items.filter(landsInPackagesUi)) {
        for (const file of item.files ?? []) {
          if (!/\.tsx?$/.test(file.path)) {
            continue;
          }
          for (const [, subpath] of (await readFile(file.path, "utf8")).matchAll(
            /from\s+"@acme\/ui\/([^"]+)"/g,
          )) {
            if (!Object.keys(exports).some((pattern) => exportMatches(pattern, `./${subpath}`))) {
              unreachable.push(`${item.name}: @acme/ui/${subpath}`);
            }
          }
        }
      }

      expect(unreachable).toEqual([]);
    });
  });

  describe("config/branding is the branding every app imports (035, 080)", () => {
    const TEMPLATE = join(MODULES, "config/branding/template");
    const text = (path: string): Promise<string> => readFile(join(TEMPLATE, path), "utf8");
    const brandingModule = async () => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const found = catalog.modules.find(
        ({ manifest }) => manifest.category === "config" && manifest.id === "branding",
      );
      if (!found) {
        throw new Error("registry/modules/config/branding is missing");
      }
      const [variant] = found.manifest.variants;
      if (!variant) {
        throw new Error("config/branding has no variant");
      }
      return { ...found, variant };
    };

    /** What `add` does to the one placeholder a template may carry. */
    const rendered = (source: string, scope: string): string =>
      source.replaceAll("{{SCOPE}}", scope);

    test("it writes packages/config from explicit paths, and `{{SCOPE}}/config` is its workspace", async () => {
      const { manifest, variant } = await brandingModule();

      expect(manifest.peers).toEqual({});
      expect(variant.match).toEqual({});
      expect(variant.workspace).toEqual({ name: "{{SCOPE}}/config", path: "packages/config" });
      expect(variant.copy?.filter((path) => /[*?[\]{}]/.test(path))).toEqual([]);
      expect(variant.copy).toEqual([
        "packages/config/package.json",
        "packages/config/tsconfig.json",
        "packages/config/branding.json",
        "packages/config/scripts/gen-branding.ts",
        "packages/config/assets/favicons/favicon.svg",
        "packages/config/assets/favicons/site.webmanifest",
        "packages/config/src/branding.generated.ts",
        "packages/config/src/branding.types.ts",
        "packages/config/src/gen-branding.test.ts",
        "packages/config/src/gen-branding.ts",
        "packages/config/src/index.ts",
      ]);
      expect(variant.dependencies ?? {}).toEqual({});
      expect(variant.devDependencies ?? {}).toEqual({});
      expect(variant.intent ?? []).toEqual([]);
    });

    test("its package.json carries exports and scripts and no dependency map (the variant has none to merge)", async () => {
      const body: unknown = JSON.parse(await text("packages/config/package.json"));

      expect(body).toMatchObject({
        name: "{{SCOPE}}/config",
        exports: {
          ".": "./src/index.ts",
          "./branding": "./src/branding.generated.ts",
          "./assets/*": "./assets/*",
        },
        scripts: { typecheck: "tsc --noEmit", test: "bun test" },
      });
      for (const map of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        expect(body).not.toHaveProperty(map);
      }
    });

    test("it adds `gen:branding` to the root package.json with scripts.merge, and the script runs a file the module copies", async () => {
      const { manifest, variant } = await brandingModule();

      expect(variant.patch).toEqual([
        {
          type: "scripts.merge",
          file: "package.json",
          scripts: { "gen:branding": "bun packages/config/scripts/gen-branding.ts" },
        },
      ]);
      expect(variant.copy).toContain("packages/config/scripts/gen-branding.ts");
      expect(manifest.checks).toContain("bun run gen:branding");
    });

    test("a package-homed module writes only inside its package (035 seam)", async () => {
      const homes: Partial<Record<string, string>> = {
        config: "packages/config",
        ui: "packages/ui",
      };
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const outside: string[] = [];

      for (const { manifest } of catalog.modules) {
        const home = homes[manifest.category];
        if (home === undefined) {
          continue;
        }
        for (const variant of manifest.variants) {
          for (const path of variant.copy ?? []) {
            if (!path.startsWith(`${home}/`)) {
              outside.push(`${manifest.category}/${manifest.id}: ${path}`);
            }
          }
        }
      }

      expect(outside).toEqual([]);
    });

    test("the generated module is what its generator renders from branding.json, at any scope", async () => {
      const json = await text("packages/config/branding.json");
      const generated = await text("packages/config/src/branding.generated.ts");

      // A drift here is `bun run gen:branding` rewriting a file `bg.json` recorded the sha256 of.
      for (const scope of ["@a", "@app", "@acme", "@a-much-longer-company-scope"]) {
        const branding = assertBranding(JSON.parse(rendered(json, scope)));
        expect(branding.npmScope).toBe(scope);
        expect(renderBrandingModule(branding)).toBe(rendered(generated, scope));
      }
    });

    const LEGACY = join(ROOT, "packages/config");
    const LEGACY_SCRIPT = join(ROOT, "scripts/gen-branding.ts");
    const LEGACY_BRANDING = join(ROOT, "branding.json");
    const LEGACY_FAVICONS = join(ROOT, "assets/favicons");

    test.skipIf(!existsSync(LEGACY))(
      "while the legacy package is in the tree, each file is its legacy file byte for byte (080: no rewrites)",
      async () => {
        const different: string[] = [];
        const same = async (module: string, legacy: string, scope = "@acme") => {
          if (rendered(await text(module), scope) !== (await readFile(legacy, "utf8"))) {
            different.push(`${module} differs from ${legacy}`);
          }
        };

        for (const file of [
          "branding.generated.ts",
          "branding.types.ts",
          "gen-branding.test.ts",
          "gen-branding.ts",
          "index.ts",
        ]) {
          await same(`packages/config/src/${file}`, join(LEGACY, "src", file));
        }
        await same("packages/config/branding.json", LEGACY_BRANDING);
        for (const file of ["favicon.svg", "site.webmanifest"]) {
          await same(`packages/config/assets/favicons/${file}`, join(LEGACY_FAVICONS, file));
        }

        expect(different).toEqual([]);
      },
    );

    test.skipIf(!existsSync(LEGACY_SCRIPT))(
      "the generator is the legacy script with its paths moved into the package, and nothing else",
      async () => {
        // The legacy script sits in the repo's scripts/ and reads the repo's branding.json. The module
        // may not write outside packages/config, so both move there; these are the lines that follow,
        // and the shorter import, which the formatter writes on one line.
        const moved = (await readFile(LEGACY_SCRIPT, "utf8"))
          .replace(
            " * Reads branding.json and writes packages/config/src/branding.generated.ts",
            " * Reads packages/config/branding.json and writes packages/config/src/branding.generated.ts",
          )
          .replace(
            " *   bun scripts/gen-branding.ts",
            " *   bun packages/config/scripts/gen-branding.ts",
          )
          .replace(
            'import {\n  assertBranding,\n  renderBrandingModule,\n  type Branding,\n} from "../packages/config/src/gen-branding";',
            'import { assertBranding, renderBrandingModule, type Branding } from "../src/gen-branding";',
          )
          .replace(
            'const ROOT = resolve(import.meta.dir, "..");',
            'const PACKAGE_DIR = resolve(import.meta.dir, "..");',
          )
          .replace('join(ROOT, "branding.json")', 'join(PACKAGE_DIR, "branding.json")')
          .replace(
            'join(ROOT, "packages/config/src/branding.generated.ts")',
            'join(PACKAGE_DIR, "src/branding.generated.ts")',
          );

        expect(await text("packages/config/scripts/gen-branding.ts")).toBe(moved);
      },
    );

    test("its tsconfig extends the project's and covers the generator script", async () => {
      const body: unknown = JSON.parse(await text("packages/config/tsconfig.json"));

      expect(body).toMatchObject({
        extends: "../../tsconfig.json",
        // The generator reads files and `import.meta.dir`: without the types `tsc` cannot see them.
        compilerOptions: { types: ["bun"] },
        include: ["src/**/*.ts", "scripts/**/*.ts"],
      });
    });
  });

  describe("api/elysia is the API shell, one variant per provider (035, 060)", () => {
    const TEMPLATE = join(MODULES, "api/elysia/template");
    const text = (path: string): Promise<string> => readFile(join(TEMPLATE, path), "utf8");
    const apiModule = async () => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const found = catalog.modules.find(
        ({ manifest }) => manifest.category === "api" && manifest.id === "elysia",
      );
      if (!found) {
        throw new Error("registry/modules/api/elysia is missing");
      }
      const providers = catalog.modules
        .filter(({ manifest }) => manifest.category === "provider")
        .map(({ manifest }) => manifest.id);
      const variants = new Map(found.manifest.variants.map((variant) => [variant.key, variant]));
      return { ...found, variants, providers };
    };
    const WRANGLER = "apps/api/wrangler.jsonc";
    /** The sources a variant writes under `apps/api/src`, which is what its imports are read from. */
    const sources = async (copy: string[]): Promise<[string, string][]> =>
      Promise.all(
        copy
          .filter((path) => /^apps\/api\/src\/.+\.ts$/.test(path))
          .map(async (path): Promise<[string, string]> => [path, await text(path)]),
      );

    test("it peers on a provider and on the config, and ships one variant per provider the registry has", async () => {
      const { manifest, variants, providers } = await apiModule();

      expect(manifest.peers).toEqual({ provider: [], config: ["branding"] });
      expect([...variants.keys()].sort()).toEqual([...providers].sort());
      for (const [key, variant] of variants) {
        expect(variant.match).toEqual({ provider: key });
        expect(variant.workspace).toEqual({ name: "{{SCOPE}}/api", path: "apps/api" });
        expect(variant.copy?.filter((path) => /[*?[\]{}]/.test(path))).toEqual([]);
      }
    });

    test("the variants differ by the paths they list: wrangler.jsonc is the cloudflare variant's alone", async () => {
      const { variants } = await apiModule();
      const cloudflare = variants.get("cloudflare")?.copy ?? [];
      const dockerfile = variants.get("dockerfile")?.copy ?? [];

      expect(cloudflare).toContain(WRANGLER);
      expect(dockerfile).not.toContain(WRANGLER);
      expect(cloudflare.filter((path) => path !== WRANGLER)).toEqual(dockerfile);
      for (const path of cloudflare) {
        expect(existsSync(join(TEMPLATE, path))).toBe(true);
      }
    });

    test("a provider-specific script is a scripts.merge patch of its variant, and the vendored package.json carries none", async () => {
      const { variants } = await apiModule();
      const body: unknown = JSON.parse(await text("apps/api/package.json"));
      const scripts = isRecord(body) && isRecord(body.scripts) ? body.scripts : {};

      // On a vendored file a patch is computed on the template: a script it already holds would
      // make the first install see the region as present and equal, and report it `skipped`.
      expect(Object.keys(scripts)).not.toContain("dev");
      expect(Object.keys(scripts)).not.toContain("deploy");
      expect(variants.get("cloudflare")?.patch).toEqual([
        {
          type: "scripts.merge",
          file: "apps/api/package.json",
          scripts: { dev: "wrangler dev --port 5172", deploy: "wrangler deploy" },
        },
      ]);
      expect(variants.get("cloudflare")?.devDependencies).toEqual({ wrangler: "4.119.0" });
      expect(variants.get("dockerfile")?.patch).toEqual([
        {
          type: "scripts.merge",
          file: "apps/api/package.json",
          scripts: { dev: "bun --watch src/index.ts" },
        },
      ]);
      expect(variants.get("dockerfile")?.devDependencies ?? {}).toEqual({});
    });

    test("both variants depend on the runtime package and the config as workspaces, and pin the rest identically", async () => {
      const { variants } = await apiModule();
      const [cloudflare, dockerfile] = [variants.get("cloudflare"), variants.get("dockerfile")];

      expect(cloudflare?.dependencies).toEqual(dockerfile?.dependencies);
      expect(cloudflare?.dependencies).toMatchObject({
        "{{SCOPE}}/api-runtime": "workspace:*",
        "{{SCOPE}}/config": "workspace:*",
        // One copy of elysia: the `app` handed to `serve()` has the type the runtime package expects.
        elysia: "1.4.29",
      });
    });

    test("its package.json carries exports and scripts and no dependency map, and exposes what the fronts import", async () => {
      const body: unknown = JSON.parse(await text("apps/api/package.json"));

      expect(body).toMatchObject({
        name: "{{SCOPE}}/api",
        exports: { ".": "./src/index.ts", "./app": "./src/app.ts", "./lib/*": "./src/lib/*.ts" },
        scripts: { typecheck: expect.any(String), test: expect.any(String) },
      });
      for (const map of ["dependencies", "devDependencies", "peerDependencies"]) {
        expect(isRecord(body) && map in body ? map : null).toBeNull();
      }
      // The fronts reach the API through `type App` and `lib/eden`: a subpath missing here is not
      // seen by the fronts' tsconfig `paths` in this repo, and breaks their typecheck in a project.
      const exports = isRecord(body) && isRecord(body.exports) ? body.exports : {};
      for (const subpath of ["./app", "./lib/eden"]) {
        const pattern = Object.keys(exports).find((key) => exportMatches(key, subpath));
        expect(pattern).toBeDefined();
        const target = String(exports[pattern ?? ""]).replace(
          "*",
          subpath.split("/").slice(2).join("/"),
        );
        expect(existsSync(join(TEMPLATE, "apps/api", target))).toBe(true);
      }
    });

    test("every `{{SCOPE}}/api/<subpath>` the template imports is an export of the package", async () => {
      const { variants } = await apiModule();
      const body: unknown = JSON.parse(await text("apps/api/package.json"));
      const exports = isRecord(body) && isRecord(body.exports) ? Object.keys(body.exports) : [];
      const unreachable: string[] = [];

      for (const [path, source] of await sources(variants.get("cloudflare")?.copy ?? [])) {
        for (const [, subpath] of source.matchAll(/from\s+"\{\{SCOPE\}\}\/api\/([^"]+)"/g)) {
          const target = `./${subpath}`;
          const matched = exports.find((pattern) => exportMatches(pattern, target));
          // The wildcard serves a file that exists: `./lib/*` is `./src/lib/*.ts`.
          const file = matched === undefined ? null : `apps/api/src/${subpath}.ts`;
          if (file === null || !existsSync(join(TEMPLATE, file))) {
            unreachable.push(`${path}: {{SCOPE}}/api/${subpath}`);
          }
        }
      }

      expect(unreachable).toEqual([]);
    });

    test("every package the template imports is declared by the variant, or is the project's own", async () => {
      const { variants } = await apiModule();
      const missing: string[] = [];

      for (const [key, variant] of variants) {
        const declared = new Set([
          ...Object.keys(variant.dependencies ?? {}),
          ...Object.keys(variant.devDependencies ?? {}),
          // The module's own package, which it reaches through `exports`.
          "{{SCOPE}}/api",
        ]);
        for (const [path, source] of await sources(variant.copy ?? [])) {
          for (const name of packagesImportedBy(source)) {
            // `bun:test` and `node:*` are the runtime's; the rest has to be in a dependency map.
            if (!name.includes(":") && !declared.has(name)) {
              missing.push(`${key} ${path}: ${name}`);
            }
          }
        }
      }

      expect(missing).toEqual([]);
    });

    test("the entry is the thin one, and app.ts keeps `app` under that name with a place for modules to plug in", async () => {
      // 035: the one thing an app-homed module may write under apps/<id>/src is imports and one call.
      expect(await text("apps/api/src/index.ts")).toBe(
        'import { serve } from "{{SCOPE}}/api-runtime";\nimport { app } from "./app";\n\nexport default serve(app);\n',
      );

      const app = await text("apps/api/src/app.ts");
      expect(app).toContain("export const app = new Elysia(runtimeOptions)");
      expect(app).toContain("export type App = typeof app;");
      const lastUse = app.lastIndexOf("\n  .use(");
      const insertion = app.indexOf("Insertion point for the modules");
      const firstRoute = app.indexOf("\n  .get(");
      expect(lastUse).toBeGreaterThan(-1);
      expect(insertion).toBeGreaterThan(lastUse);
      expect(firstRoute).toBeGreaterThan(insertion);
    });

    test("the shell has no database, auth, storage or email: those arrive as modules of their own", async () => {
      const { variants } = await apiModule();
      const offending: string[] = [];

      for (const [path, source] of await sources(variants.get("cloudflare")?.copy ?? [])) {
        for (const word of [
          "D1Database",
          "R2Bucket",
          "BETTER_AUTH",
          "RESEND",
          "dbModule",
          "authModule",
          "mediaModule",
        ]) {
          if (source.includes(word)) {
            offending.push(`${path}: ${word}`);
          }
        }
      }
      expect(offending).toEqual([]);
      expect(Object.keys(variants.get("cloudflare")?.dependencies ?? {})).not.toContain(
        "drizzle-orm",
      );
    });
  });

  test("every patch a variant declares is one the CLI applies, with arguments it accepts", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const refused: string[] = [];

    for (const { manifest } of catalog.modules) {
      for (const variant of manifest.variants) {
        try {
          plannedPatches(`${manifest.category}/${manifest.id}`, variant);
        } catch (error) {
          refused.push(error instanceof Error ? error.message : String(error));
        }
      }
    }

    expect(refused).toEqual([]);
  });

  test("every copy glob of every variant matches a file under template/", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const unmatched: string[] = [];

    for (const { manifest, dir } of catalog.modules) {
      for (const variant of manifest.variants) {
        for (const glob of variant.copy ?? []) {
          const matches = await Array.fromAsync(
            new Bun.Glob(glob).scan({ cwd: join(dir, "template"), dot: true, onlyFiles: true }),
          );
          if (matches.length === 0) {
            unmatched.push(`${manifest.category}/${manifest.id} ${variant.key}: ${glob}`);
          }
        }
      }
    }

    expect(unmatched).toEqual([]);
  });

  test("no module id is also an item name, since `bg add <name>` would be ambiguous", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const itemNames = new Set(catalog.items.map((item) => item.name));

    expect(
      catalog.modules.map(({ manifest }) => manifest.id).filter((id) => itemNames.has(id)),
    ).toEqual([]);
  });
});
