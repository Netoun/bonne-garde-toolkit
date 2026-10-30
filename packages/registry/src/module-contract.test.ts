import { describe, expect, test } from "bun:test";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, posix } from "node:path";
import {
  createEmptyProjectManifest,
  isModuleCategory,
  parseModuleManifest,
} from "@bonne-garde/schema";
import {
  assertBranding,
  renderBrandingModule,
} from "../../../registry/modules/config/branding/template/packages/config/src/gen-branding";
import { formatWithProjectFormatter } from "../test-support/project-formatter";
import { applyInstallPlan } from "./apply-plan";
import { loadLocalRegistry } from "./load-registry";
import { resolveModulePlans } from "./module-plan";
import { patchRegions, writePatch } from "./patch-ops";
import { plannedPatches } from "./patch-plan";
import { addNamedExport } from "./ts-patches";

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

  test("tooling/vite-plus leaves the migrations drizzle-kit generates alone: `vp fmt` would rewrite the JSON it writes", async () => {
    const config: unknown = (
      await import(join(MODULES, "tooling/vite-plus/template/vite.config.ts"))
    ).default;
    const fmt = isRecord(config) ? config.fmt : undefined;
    const ignored = isRecord(fmt) && Array.isArray(fmt.ignorePatterns) ? fmt.ignorePatterns : [];

    // `orm/drizzle` runs `drizzle-kit generate` into `packages/db/migrations` (035's home for `orm`).
    // It rewrites `meta/_journal.json` and the snapshot each time, in its own layout, so a project
    // that formats them fails `bun run check` right after its first `bun run db:generate`.
    expect(ignored).toContain("packages/db/migrations/");
  });

  test("every dependency a variant or a package.dependencies patch declares is an exact version (035: exact version maps)", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const loose: string[] = [];

    for (const { manifest } of catalog.modules) {
      for (const variant of manifest.variants) {
        // A `package.dependencies` patch writes dependencies too (060): its versions are held to the same rule.
        const patched = (variant.patch ?? []).flatMap((patch) =>
          patch.type === "package.dependencies" ? [patch.dependencies, patch.devDependencies] : [],
        );
        for (const map of [variant.dependencies ?? {}, variant.devDependencies ?? {}, ...patched]) {
          for (const [name, declared] of Object.entries(isRecord(map) ? map : {})) {
            const version = String(declared);
            // `workspace:*` is how a module names a sibling package of the project (`{{SCOPE}}/<name>`).
            const sibling = name.startsWith("{{SCOPE}}/") && version === "workspace:*";
            // `npm:<package>@<exact>` is an alias of an exact version: how a project names `vite-plus-core` as `vite`.
            if (
              !sibling &&
              !/^(?:npm:(?:@[^/@]+\/)?[^/@]+@)?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/.test(version)
            ) {
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
        db: "packages/db",
        orm: "packages/db",
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

  describe("web modules are the front shells of apps/<id>, one variant per provider they support (035, 080)", () => {
    type WebModule = Awaited<ReturnType<typeof loadLocalRegistry>>["modules"][number];
    const webModules = async (): Promise<WebModule[]> => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const found = catalog.modules.filter(({ manifest }) => manifest.category === "web");
      expect(found.map(({ manifest }) => manifest.id).sort()).toEqual(["spa", "ssr", "static"]);
      return found;
    };
    const providerIds = async (): Promise<string[]> => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      return catalog.modules
        .filter(({ manifest }) => manifest.category === "provider")
        .map(({ manifest }) => manifest.id)
        .sort();
    };
    const read = (module: WebModule, path: string): Promise<string> =>
      readFile(join(module.dir, "template", path), "utf8");
    /** Every module specifier a source imports, from `from "x"`, `import "x"` and CSS `@import "x"`. */
    const specifiersOf = (source: string): string[] =>
      [...source.matchAll(/(?:\bfrom|\bimport|@import)\s+["']([^"']+)["']/g)].flatMap(
        ([, specifier]) => (specifier === undefined ? [] : [specifier]),
      );
    /** `react-dom/server` is `react-dom`, `@react-router/dev/vite` is `@react-router/dev`. */
    const packageOf = (specifier: string): string => {
      const [first = "", second = ""] = specifier.split("/");
      return specifier.startsWith("@") || specifier.startsWith("{") ? `${first}/${second}` : first;
    };
    const SOURCE = /\.(?:tsx?|css)$/;
    const sourcesOf = async (module: WebModule, copy: string[]): Promise<[string, string][]> =>
      Promise.all(
        copy
          .filter((path) => SOURCE.test(path))
          .map(async (path): Promise<[string, string]> => [path, await read(module, path)]),
      );

    test("each declares the peers it imports through, and a variant for every provider it accepts", async () => {
      const providers = await providerIds();
      for (const module of await webModules()) {
        const { manifest } = module;
        const key = `web/${manifest.id}`;
        expect(Object.keys(manifest.peers)).toEqual(
          expect.arrayContaining(["provider", "config", "api"]),
        );
        const accepted = manifest.peers.provider ?? [];
        const expected = accepted.length > 0 ? [...accepted].sort() : providers;
        expect(manifest.variants.map((variant) => variant.key).sort()).toEqual(expected);
        for (const variant of manifest.variants) {
          expect(`${key} ${variant.key}: ${JSON.stringify(variant.match)}`).toBe(
            `${key} ${variant.key}: ${JSON.stringify({ provider: variant.key })}`,
          );
          expect(variant.workspace).toEqual({
            name: `{{SCOPE}}/${manifest.id}`,
            path: `apps/${manifest.id}`,
          });
          // A glob cannot be expanded over `github:`, which has no directory listing.
          expect(variant.copy?.filter((path) => /[*?[\]{}]/.test(path))).toEqual([]);
          expect(
            (variant.copy ?? []).filter((path) => !path.startsWith(`apps/${manifest.id}/`)),
          ).toEqual([]);
          for (const path of variant.copy ?? []) {
            expect(existsSync(join(module.dir, "template", path))).toBe(true);
          }
        }
      }
    });

    test("a peer other than the provider is declared exactly when a source imports its package", async () => {
      const categoryOf: Record<string, string> = {
        "{{SCOPE}}/api": "api",
        "{{SCOPE}}/config": "config",
        "{{SCOPE}}/ui": "ui",
      };
      for (const module of await webModules()) {
        const imported = new Set<string>();
        for (const variant of module.manifest.variants) {
          for (const [, source] of await sourcesOf(module, variant.copy ?? [])) {
            for (const specifier of specifiersOf(source)) {
              const category = categoryOf[packageOf(specifier)];
              if (category !== undefined) {
                imported.add(category);
              }
            }
          }
        }
        const declared = Object.keys(module.manifest.peers).filter((peer) => peer !== "provider");
        expect([module.manifest.id, [...declared].sort()]).toEqual([
          module.manifest.id,
          [...imported].sort(),
        ]);
      }
    });

    test("the vendored package.json carries scripts and no dependency map, and no script a variant patches in", async () => {
      for (const module of await webModules()) {
        const { manifest } = module;
        const body: unknown = JSON.parse(await read(module, `apps/${manifest.id}/package.json`));
        expect(body).toMatchObject({ name: `{{SCOPE}}/${manifest.id}` });
        const scripts = isRecord(body) && isRecord(body.scripts) ? body.scripts : {};
        for (const map of ["dependencies", "devDependencies", "peerDependencies"]) {
          expect(isRecord(body) && map in body ? `${manifest.id}: ${map}` : null).toBeNull();
        }
        expect(Object.keys(scripts)).toEqual(
          expect.arrayContaining(["build", "typecheck", "test"]),
        );
        for (const variant of manifest.variants) {
          // On a vendored file a patch is computed on the template: a script it already holds would
          // be reported `skipped` by the first install.
          const patched = (variant.patch ?? []).flatMap((patch) =>
            patch.type === "scripts.merge" && isRecord(patch.scripts)
              ? Object.keys(patch.scripts)
              : [],
          );
          expect(patched).toContain("dev");
          expect(patched.filter((name) => name in scripts)).toEqual([]);
          for (const patch of variant.patch ?? []) {
            expect(patch.type).toBe("scripts.merge");
            expect(patch).toMatchObject({ file: `apps/${manifest.id}/package.json` });
          }
        }
      }
    });

    test("a cloudflare variant also deploys, and carries the wrangler config and wrangler", async () => {
      for (const { manifest } of await webModules()) {
        const cloudflare = manifest.variants.find((variant) => variant.key === "cloudflare");
        const others = manifest.variants.filter((variant) => variant.key !== "cloudflare");
        expect(cloudflare?.copy).toContain(`apps/${manifest.id}/wrangler.jsonc`);
        expect(Object.keys(cloudflare?.devDependencies ?? {})).toContain("wrangler");
        for (const variant of others) {
          expect(variant.copy).not.toContain(`apps/${manifest.id}/wrangler.jsonc`);
          expect(Object.keys(variant.devDependencies ?? {})).not.toContain("wrangler");
        }
      }
    });

    test("a Pages module's pages_build_output_dir is where react-router build writes, and its deploy script deploys that directory", async () => {
      const pages: string[] = [];
      for (const module of await webModules()) {
        const { manifest } = module;
        const config = await read(module, `apps/${manifest.id}/react-router.config.ts`);
        const wrangler = await read(module, `apps/${manifest.id}/wrangler.jsonc`);
        // JSONC with trailing commas, which JSON.parse refuses: read the one key.
        const output = /"pages_build_output_dir"\s*:\s*"([^"]*)"/.exec(wrangler)?.[1];
        if (!/\bssr:\s*false\b/.test(config)) {
          // A Worker serves its assets itself: it has no Pages output directory.
          expect(output).toBeUndefined();
          continue;
        }
        // A client-only build writes `<buildDirectory>/client`, and `buildDirectory` defaults to `build`.
        expect(config).not.toContain("buildDirectory");
        expect(output).toBe("build/client");
        const cloudflare = manifest.variants.find((variant) => variant.key === "cloudflare");
        const deploy = (cloudflare?.patch ?? []).flatMap((patch) =>
          isRecord(patch.scripts) ? [patch.scripts.deploy] : [],
        );
        expect(deploy).toEqual([`wrangler pages deploy ${output}`]);
        pages.push(manifest.id);
      }
      expect(pages.sort()).toEqual(["spa", "static"]);
    });

    test("every package a template imports is declared by the variant, or is the project's own", async () => {
      const missing: string[] = [];
      for (const module of await webModules()) {
        for (const variant of module.manifest.variants) {
          const declared = new Set([
            ...Object.keys(variant.dependencies ?? {}),
            ...Object.keys(variant.devDependencies ?? {}),
            `{{SCOPE}}/${module.manifest.id}`,
          ]);
          for (const [path, source] of await sourcesOf(module, variant.copy ?? [])) {
            for (const specifier of specifiersOf(source)) {
              const name = packageOf(specifier);
              // `bun:test`, `node:*` and `virtual:*` are the runtime's, the bundler's; `.` is a file.
              if (!specifier.startsWith(".") && !specifier.includes(":") && !declared.has(name)) {
                missing.push(`${module.manifest.id} ${variant.key} ${path}: ${name}`);
              }
            }
          }
        }
      }
      expect(missing).toEqual([]);
    });

    test("every dependency a variant declares is imported by it, or is the toolchain", async () => {
      // A module declares what its code needs. The toolchain is what `react-router`, `vite` and
      // `tsc` run on: named in the config, a script or a type, and not in an import of the sources.
      const toolchain = new Set([
        "@react-router/dev",
        "@tailwindcss/vite",
        "@types/node",
        "@types/react",
        "@types/react-dom",
        "@cloudflare/workers-types",
        "isbot",
        "jsdom",
        "tailwindcss",
        "typescript",
        "vite",
        "vite-plus",
        "wrangler",
        "@testing-library/jest-dom",
        // `react-router`'s default server entry imports it; a shell with its own entry does too.
        "react-dom",
      ]);
      const unused: string[] = [];
      for (const module of await webModules()) {
        for (const variant of module.manifest.variants) {
          const imported = new Set<string>();
          for (const [, source] of await sourcesOf(module, variant.copy ?? [])) {
            for (const specifier of specifiersOf(source)) {
              imported.add(packageOf(specifier));
            }
          }
          for (const name of [
            ...Object.keys(variant.dependencies ?? {}),
            ...Object.keys(variant.devDependencies ?? {}),
          ]) {
            if (!imported.has(name) && !toolchain.has(name) && name !== "{{SCOPE}}/api") {
              unused.push(`${module.manifest.id} ${variant.key}: ${name}`);
            }
          }
        }
      }
      expect(unused).toEqual([]);
    });

    /** The `exports` of the package a peer module writes, by `{{SCOPE}}/<name>`. */
    const PEER_PACKAGES: Record<string, { package: string; template: string }> = {
      "{{SCOPE}}/api": {
        package: "api/elysia/template/apps/api",
        template: "api/elysia/template/apps/api",
      },
      "{{SCOPE}}/config": {
        package: "config/branding/template/packages/config",
        template: "config/branding/template/packages/config",
      },
      "{{SCOPE}}/ui": {
        package: "ui/shadcn/template/packages/ui",
        template: "ui/shadcn/template/packages/ui",
      },
    };

    test("every `{{SCOPE}}/{api,config,ui}` subpath a template imports is an export of that package", async () => {
      // A subpath that is not an export resolves in this repo through nothing and in a project through
      // `exports`: the regression class the `paths` entries of the legacy fronts used to hide.
      const unreachable: string[] = [];
      for (const module of await webModules()) {
        for (const variant of module.manifest.variants) {
          for (const [path, source] of await sourcesOf(module, variant.copy ?? [])) {
            for (const specifier of specifiersOf(source)) {
              const name = packageOf(specifier);
              const peer = PEER_PACKAGES[name];
              if (peer === undefined) {
                continue;
              }
              const body: unknown = JSON.parse(
                await readFile(join(MODULES, peer.package, "package.json"), "utf8"),
              );
              const exports = isRecord(body) && isRecord(body.exports) ? body.exports : {};
              const subpath = `.${specifier.slice(name.length)}`;
              const pattern = Object.keys(exports).find((key) => exportMatches(key, subpath));
              if (pattern === undefined) {
                unreachable.push(`${module.manifest.id} ${path}: ${specifier}`);
              }
            }
          }
        }
      }
      expect(unreachable).toEqual([]);
    });

    test("no template imports a UI item: a module never depends on an item (09 section 2b)", async () => {
      const importing: string[] = [];
      for (const module of await webModules()) {
        for (const variant of module.manifest.variants) {
          for (const [path, source] of await sourcesOf(module, variant.copy ?? [])) {
            for (const specifier of specifiersOf(source)) {
              // The host package's own files (`globals.css`, `themes/*`) are the `ui` module's; the
              // components, hooks and lib helpers are items, absent from a project that adds none.
              if (/^\{\{SCOPE\}\}\/ui\/(?:components|hooks|lib)\//.test(specifier)) {
                importing.push(`${module.manifest.id} ${path}: ${specifier}`);
              }
            }
          }
        }
      }
      expect(importing).toEqual([]);
    });

    test("no import leaves the app: a relative path stays under apps/<id>, and the rest is a package", async () => {
      // The legacy fronts reached `../../testing`, `../../../packages/ui/src` and `../../../../testing`;
      // a module's files may only reach another tree through that tree's package `exports` (035 seam).
      const leaving: string[] = [];
      for (const module of await webModules()) {
        const home = `apps/${module.manifest.id}`;
        for (const variant of module.manifest.variants) {
          for (const [path, source] of await sourcesOf(module, variant.copy ?? [])) {
            for (const specifier of specifiersOf(source).filter((name) => name.startsWith("."))) {
              const target = posix.normalize(posix.join(posix.dirname(path), specifier));
              if (target !== home && !target.startsWith(`${home}/`)) {
                leaving.push(`${module.manifest.id} ${path}: ${specifier}`);
              }
            }
          }
        }
      }
      expect(leaving).toEqual([]);
    });

    test("its tsconfig keeps one `paths` entry, the app's own alias, and reaches into no other tree", async () => {
      for (const module of await webModules()) {
        const { manifest } = module;
        const body: unknown = JSON.parse(await read(module, `apps/${manifest.id}/tsconfig.json`));
        const options =
          isRecord(body) && isRecord(body.compilerOptions) ? body.compilerOptions : {};
        const paths = isRecord(options.paths) ? options.paths : {};
        for (const [alias, targets] of Object.entries(paths)) {
          expect(Array.isArray(targets) ? targets : []).toSatisfy((list: string[]) =>
            list.every((target) => target.startsWith("./")),
          );
          expect(
            alias === `{{SCOPE}}/${manifest.id}/*` || alias === "+types/*" ? null : alias,
          ).toBeNull();
        }
      }
    });

    test("the Eden client reaches the API's root: the shell has no `/v1` group", async () => {
      const mentioning: string[] = [];
      for (const module of await webModules()) {
        for (const variant of module.manifest.variants) {
          for (const [path, source] of await sourcesOf(module, variant.copy ?? [])) {
            if (/\.v1\b|\bmedia\(/.test(source)) {
              mentioning.push(`${module.manifest.id} ${path}`);
            }
          }
        }
      }
      expect(mentioning).toEqual([]);
    });
  });

  describe("db/d1 and orm/drizzle share packages/db, and db/d1 owns the package (035, 060)", () => {
    const D1 = join(MODULES, "db/d1/template");
    const ORM = join(MODULES, "orm/drizzle/template");
    const d1Text = (path: string): Promise<string> => readFile(join(D1, path), "utf8");
    const ormText = (path: string): Promise<string> => readFile(join(ORM, path), "utf8");
    const dbModules = async () => {
      const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
      const find = (category: string, id: string) => {
        const found = catalog.modules.find(
          ({ manifest }) => manifest.category === category && manifest.id === id,
        );
        const [variant] = found?.manifest.variants ?? [];
        if (!found || !variant) {
          throw new Error(`registry/modules/${category}/${id} is missing or has no variant`);
        }
        return { ...found, variant };
      };
      return { catalog, d1: find("db", "d1"), orm: find("orm", "drizzle") };
    };
    /** The `value` of the one `jsonc.merge` patch of a variant on `file`. */
    const mergedInto = (patches: { type: string; file?: unknown }[] | undefined, file: string) => {
      const found = (patches ?? []).find(
        (patch) => patch.type === "jsonc.merge" && patch.file === file,
      );
      return found !== undefined && "value" in found && isRecord(found.value) ? found.value : {};
    };
    /** Every file of a template, relative to it. */
    const templateFiles = async (dir: string): Promise<string[]> =>
      (
        await Array.fromAsync(new Bun.Glob("**/*").scan({ cwd: dir, dot: true, onlyFiles: true }))
      ).sort();
    /** The packages a source names: its imports, and the `/// <reference types>` that stands for one. */
    const packagesNamedBy = (source: string): string[] => [
      ...packagesImportedBy(source),
      ...[...source.matchAll(/<reference types="([^"]+)"/g)].flatMap(([, name]) =>
        name === undefined ? [] : [name],
      ),
    ];
    /** A source without its comment lines: a comment may quote an import it does not make. */
    const code = (source: string): string =>
      source
        .split("\n")
        .filter((line) => !/^\s*(?:\/\/(?!\/ <reference)|\/?\*)/.test(line))
        .join("\n");
    const SOURCE = /^packages\/db\/src\/.+\.ts$/;
    const sourcesOf = async (): Promise<[string, string][]> => {
      const { d1, orm } = await dbModules();
      const all: [string, string][] = [];
      for (const [module, read] of [
        [d1, d1Text],
        [orm, ormText],
      ] as const) {
        for (const path of module.variant.copy ?? []) {
          if (SOURCE.test(path)) {
            all.push([path, code(await read(path))]);
          }
        }
      }
      return all;
    };

    test("db/d1 peers on the cloudflare provider and ships that one variant, which owns the workspace", async () => {
      const { catalog, d1 } = await dbModules();
      const providers = catalog.modules
        .filter(({ manifest }) => manifest.category === "provider")
        .map(({ manifest }) => manifest.id);

      expect(d1.manifest.peers).toEqual({ provider: ["cloudflare"] });
      // 035: a `db` module ships one variant per provider it supports, and the allow-list says which.
      expect(d1.manifest.variants.map((variant) => variant.key)).toEqual(
        providers.filter((id) => d1.manifest.peers.provider?.includes(id)),
      );
      expect(d1.variant.key).toBe("cloudflare");
      expect(d1.variant.match).toEqual({ provider: "cloudflare" });
      expect(d1.variant.workspace).toEqual({ name: "{{SCOPE}}/db", path: "packages/db" });
      expect(d1.variant.copy).toEqual([
        "packages/db/package.json",
        "packages/db/tsconfig.json",
        "packages/db/tsconfig.test.json",
        "packages/db/src/d1.ts",
        "packages/db/src/d1.test.ts",
      ]);
      expect(d1.variant.intent ?? []).toEqual([]);
    });

    test("orm/drizzle peers on any db, has the one variant matched on d1, and writes into the package without owning it", async () => {
      const { orm } = await dbModules();

      expect(orm.manifest.peers).toEqual({ db: [] });
      expect(orm.manifest.variants).toHaveLength(1);
      expect(orm.variant.key).toBe("d1");
      expect(orm.variant.match).toEqual({ db: "d1" });
      // The package.json and its workspace are db/d1's: two claimants for one file are refused.
      expect(orm.variant.workspace).toBeUndefined();
      expect(orm.variant.dependencies ?? {}).toEqual({});
      expect(orm.variant.devDependencies ?? {}).toEqual({});
      expect(orm.variant.copy).toEqual([
        "packages/db/src/client.ts",
        "packages/db/src/client.test.ts",
        "packages/db/src/drizzle.config.ts",
        "packages/db/src/index.ts",
        "packages/db/src/module.ts",
        "packages/db/src/module.test.ts",
        "packages/db/src/schema/index.ts",
        "packages/db/src/testing.ts",
        "packages/db/src/testing.test.ts",
      ]);
      expect(orm.variant.intent ?? []).toEqual([]);
    });

    test("the two modules write distinct files, every copy exists, and nothing is a glob", async () => {
      const { d1, orm } = await dbModules();
      const copies = [...(d1.variant.copy ?? []), ...(orm.variant.copy ?? [])];

      expect(new Set(copies).size).toBe(copies.length);
      expect(copies.filter((path) => /[*?[\]{}]/.test(path))).toEqual([]);
      for (const path of d1.variant.copy ?? []) {
        expect(existsSync(join(D1, path))).toBe(true);
      }
      for (const path of orm.variant.copy ?? []) {
        expect(existsSync(join(ORM, path))).toBe(true);
      }
      // Nothing in a template that no variant copies.
      expect(await templateFiles(D1)).toEqual([...(d1.variant.copy ?? [])].sort());
      expect(await templateFiles(ORM)).toEqual([...(orm.variant.copy ?? [])].sort());
    });

    test("they ship schemas, not SQL: the project generates its migrations (09 stage 4 watch)", async () => {
      const files = [...(await templateFiles(D1)), ...(await templateFiles(ORM))];

      expect(files.filter((path) => /\.sql$|(?:^|\/)migrations\//.test(path))).toEqual([]);
      // `bun run db:generate` writes where the D1 binding reads: drizzle-kit's `out`, relative to
      // `packages/db`, is the `migrations_dir` of `apps/api/wrangler.jsonc`, relative to `apps/api`.
      expect(await ormText("packages/db/src/drizzle.config.ts")).toContain('out: "./migrations"');
      expect(await ormText("packages/db/src/drizzle.config.ts")).toContain(
        'schema: "./src/schema/index.ts"',
      );
    });

    test("package.json is vendored by db/d1 with its own subpath and scripts, and no dependency map", async () => {
      const body: unknown = JSON.parse(await d1Text("packages/db/package.json"));

      expect(body).toMatchObject({
        name: "{{SCOPE}}/db",
        exports: { "./d1": "./src/d1.ts" },
        scripts: {
          typecheck: expect.any(String),
          "typecheck:test": expect.any(String),
          test: "bun test",
        },
      });
      for (const map of [
        "dependencies",
        "devDependencies",
        "peerDependencies",
        "optionalDependencies",
      ]) {
        expect(isRecord(body) && map in body ? map : null).toBeNull();
      }
      // What orm adds is a region each, so the vendored file holds none of it.
      expect(JSON.stringify(body)).not.toContain("db:generate");
    });

    test("orm adds its subpaths and scripts to that file with patches, and every subpath is a file it ships", async () => {
      const { orm } = await dbModules();
      const value = mergedInto(orm.variant.patch, "packages/db/package.json");
      const exports = isRecord(value.exports) ? value.exports : {};

      expect(exports).toEqual({
        ".": "./src/index.ts",
        "./schema": "./src/schema/index.ts",
        "./testing": "./src/testing.ts",
      });
      for (const target of Object.values(exports)) {
        expect(orm.variant.copy).toContain(`packages/db/${String(target).replace("./", "")}`);
      }
      const scripts = orm.variant.patch?.find((patch) => patch.type === "scripts.merge");
      expect(scripts).toEqual({
        type: "scripts.merge",
        file: "packages/db/package.json",
        scripts: {
          "db:generate": "drizzle-kit generate --config ./src/drizzle.config.ts",
          "db:studio": "drizzle-kit studio --config ./src/drizzle.config.ts",
        },
      });
      // The `--config` of each script is a file orm copies.
      expect(orm.variant.copy).toContain("packages/db/src/drizzle.config.ts");
    });

    /** The `package.dependencies` patch of a variant on `file`, as declared. */
    const dependenciesPatch = (
      patches: { type: string; file?: unknown }[] | undefined,
      file: string,
    ) => {
      const found = (patches ?? []).find(
        (patch) => patch.type === "package.dependencies" && patch.file === file,
      );
      const mapOf = (value: unknown): Record<string, string> =>
        isRecord(value)
          ? Object.fromEntries(
              Object.entries(value).flatMap(([name, version]) =>
                typeof version === "string" ? [[name, version]] : [],
              ),
            )
          : {};
      return {
        dependencies: mapOf(
          found !== undefined && "dependencies" in found ? found.dependencies : {},
        ),
        devDependencies: mapOf(
          found !== undefined && "devDependencies" in found ? found.devDependencies : {},
        ),
      };
    };

    test("orm merges only its subpaths with jsonc.merge, and its dependencies with package.dependencies (060)", async () => {
      const { orm } = await dbModules();

      // A subpath is a leaf the formatter does not move; a dependency is one it sorts, so it has its own patch.
      expect(Object.keys(mergedInto(orm.variant.patch, "packages/db/package.json"))).toEqual([
        "exports",
      ]);
      expect(dependenciesPatch(orm.variant.patch, "packages/db/package.json")).toEqual({
        dependencies: { "drizzle-orm": "0.45.2", elysia: "1.4.29" },
        // `drizzle-kit` is a dev dependency again: it sorts between db/d1's two, which the patch handles.
        devDependencies: { "drizzle-kit": "0.31.10" },
      });
    });

    test("the dependencies the two modules declare are each imported, and every import is declared", async () => {
      const { d1, orm } = await dbModules();
      const added = dependenciesPatch(orm.variant.patch, "packages/db/package.json");
      const declared = new Set([
        ...Object.keys(d1.variant.dependencies ?? {}),
        ...Object.keys(d1.variant.devDependencies ?? {}),
        ...Object.keys(added.dependencies),
        ...Object.keys(added.devDependencies),
      ]);
      const named = new Set<string>();

      for (const [path, source] of await sourcesOf()) {
        for (const name of packagesNamedBy(source)) {
          if (!name.includes(":")) {
            named.add(name);
            expect([path, declared.has(name)]).toEqual([path, true]);
          }
        }
      }

      // And nothing is declared that no source of the package names.
      expect([...declared].filter((name) => !named.has(name))).toEqual([]);
    });

    test("package.json as the project gets it, db/d1's entries and orm's in one file, is what the formatter writes", async () => {
      const { catalog } = await dbModules();
      const project = createEmptyProjectManifest({ scope: "@app", registries: {} });
      const plans = await resolveModulePlans(
        catalog,
        [
          { category: "provider", id: "cloudflare" },
          { category: "db", id: "d1" },
          { category: "orm", id: "drizzle" },
        ],
        project,
      );
      const file = "packages/db/package.json";
      const planned = plans
        .find(({ key }) => key === "db/d1")
        ?.files.find((f) => f.target === file);
      const ormPlan = plans.find(({ key }) => key === "orm/drizzle");

      // What `bg add db/d1 orm/drizzle` writes: the vendored file with the variant's maps merged in
      // (sorted by the planner), then orm's patches on it, in the order declared.
      let text = planned?.content ?? "";
      for (const patch of ormPlan?.patches ?? []) {
        if (patch.file === file) {
          text = writePatch(text, patch, new Set(patchRegions(patch).map(({ region }) => region)));
        }
      }

      const body: unknown = JSON.parse(text);
      expect(
        isRecord(body) && isRecord(body.dependencies) ? Object.keys(body.dependencies) : [],
      ).toEqual(["@app/api-runtime", "drizzle-orm", "elysia"]);
      // `drizzle-kit` goes between db/d1's two dev dependencies, not after them.
      expect(
        isRecord(body) && isRecord(body.devDependencies) ? Object.keys(body.devDependencies) : [],
      ).toEqual(["@cloudflare/workers-types", "drizzle-kit", "miniflare"]);
      await expect(formatWithProjectFormatter({ [file]: text })).resolves.toEqual({ [file]: text });
    });

    test("a peer is declared exactly when a source reaches the module's package or file", async () => {
      const { catalog, d1, orm } = await dbModules();
      const provider = catalog.modules.find(
        ({ manifest }) => manifest.category === "provider" && manifest.id === "cloudflare",
      );

      // The package `provider/cloudflare` owns is the one `readRuntimeEnv` comes from.
      expect(provider?.manifest.variants[0]?.workspace?.name).toBe("{{SCOPE}}/api-runtime");
      expect(d1.variant.dependencies).toEqual({ "{{SCOPE}}/api-runtime": "workspace:*" });
      const d1Imports = new Set<string>();
      const ormImports = new Set<string>();
      for (const [path, source] of await sourcesOf()) {
        const into = d1.variant.copy?.includes(path) ? d1Imports : ormImports;
        for (const [, specifier] of source.matchAll(/from\s+"([^"]+)"/g)) {
          into.add(specifier ?? "");
        }
      }
      expect(d1Imports.has("{{SCOPE}}/api-runtime")).toBe(true);
      expect(ormImports.has("./d1")).toBe(true);
      expect([...ormImports].filter((specifier) => specifier.startsWith("{{SCOPE}}/"))).toEqual([]);
      expect(Object.keys(d1.manifest.peers)).toEqual(["provider"]);
      expect(Object.keys(orm.manifest.peers)).toEqual(["db"]);
    });

    test("no relative import leaves the package, and each one names a file a module ships", async () => {
      const shipped = new Set([...(await templateFiles(D1)), ...(await templateFiles(ORM))]);
      const unresolved: string[] = [];

      for (const [path, source] of await sourcesOf()) {
        for (const [, specifier] of source.matchAll(/from\s+"(\.[^"]*)"/g)) {
          const target = posix.normalize(posix.join(posix.dirname(path), specifier ?? ""));
          const found = [`${target}.ts`, `${target}/index.ts`].some((file) => shipped.has(file));
          if (!target.startsWith("packages/db/src/") || !found) {
            unresolved.push(`${path}: ${specifier}`);
          }
        }
      }

      expect(unresolved).toEqual([]);
    });

    test("db/d1 declares the D1 binding in the Worker's wrangler.jsonc, top level and production, where drizzle-kit writes", async () => {
      const { catalog, d1 } = await dbModules();
      const value = mergedInto(d1.variant.patch, "apps/api/wrangler.jsonc");
      const production =
        isRecord(value.env) && isRecord(value.env.production) ? value.env.production : {};
      const binding = /D1_BINDING = "([^"]+)"/.exec(await d1Text("packages/db/src/d1.ts"))?.[1];

      expect(binding).toBe("DB");
      for (const entries of [value.d1_databases, production.d1_databases]) {
        expect(entries).toEqual([
          {
            binding,
            database_name: "my-app-db",
            // An id that exists nowhere: `wrangler d1 create` gives the real one before a deploy.
            database_id: "00000000-0000-0000-0000-000000000000",
            migrations_dir: "../../packages/db/migrations",
          },
        ]);
      }
      // The directory is `out` of the drizzle config, resolved from the package, seen from `apps/api`.
      expect(posix.resolve("/p/apps/api", "../../packages/db/migrations")).toBe(
        posix.resolve("/p/packages/db", "./migrations"),
      );
      // The file it patches is the API shell's, in the variant that has one, with a production env to merge into.
      const api = catalog.modules.find(
        ({ manifest }) => manifest.category === "api" && manifest.id === "elysia",
      );
      const wrangler = await readFile(
        join(api?.dir ?? "", "template/apps/api/wrangler.jsonc"),
        "utf8",
      );
      expect(wrangler).toContain('"production": {');
      expect(Object.keys(value)).toEqual(["d1_databases", "env"]);
    });

    test("db/d1 adds the migration scripts to the API's package.json, by the binding and not the database's name", async () => {
      const { d1 } = await dbModules();
      const scripts = d1.variant.patch?.find((patch) => patch.type === "scripts.merge");

      expect(scripts).toEqual({
        type: "scripts.merge",
        file: "apps/api/package.json",
        scripts: {
          "db:migrate:local": "wrangler d1 migrations apply DB --local",
          "db:migrate:remote": "wrangler d1 migrations apply DB --remote",
        },
      });
    });

    // This proves the text and its format. It does not prove the specifier resolves: `packages/db` has
    // to depend on `@app/auth`, which the module that adds the table declares with `package.dependencies`.
    test("the schema barrel takes the patches `auth` and `storage` bring, and stays what the formatter writes", async () => {
      const file = "packages/db/src/schema/index.ts";
      const barrel = await ormText(file);
      await expect(formatWithProjectFormatter({ [file]: barrel })).resolves.toEqual({
        [file]: barrel,
      });

      const withAuth = addNamedExport(file, barrel, "@app/auth/schema", [
        "user",
        "session",
        "organization",
      ]);
      const withBoth = addNamedExport(file, withAuth, "@app/storage/schema", ["medias"]);

      expect(withBoth).toContain(
        'export { user, session, organization } from "@app/auth/schema";\n',
      );
      expect(withBoth).toContain('export { medias } from "@app/storage/schema";\n');
      await expect(formatWithProjectFormatter({ [file]: withBoth })).resolves.toEqual({
        [file]: withBoth,
      });
    });

    test("the installed peers pick the variants, and a missing or wrong peer is named", async () => {
      const { catalog } = await dbModules();
      const project = createEmptyProjectManifest({ scope: "@app", registries: {} });
      const plans = await resolveModulePlans(
        catalog,
        [
          { category: "orm", id: "drizzle" },
          { category: "db", id: "d1" },
          { category: "provider", id: "cloudflare" },
        ],
        project,
      );

      expect(plans.map(({ key, variant }) => `${key}:${variant}`)).toEqual([
        "provider/cloudflare:default",
        "db/d1:cloudflare",
        "orm/drizzle:d1",
      ]);
      await expect(
        resolveModulePlans(catalog, [{ category: "orm", id: "drizzle" }], project),
      ).rejects.toThrow(/orm\/drizzle needs a module in category db \(any\) and none is installed/);
      await expect(
        resolveModulePlans(
          catalog,
          [
            { category: "provider", id: "dockerfile" },
            { category: "db", id: "d1" },
          ],
          project,
        ),
      ).rejects.toThrow(
        /db\/d1 accepts only cloudflare for provider, but provider\/dockerfile is present/,
      );
    });

    test("orm/drizzle wires dbModule into the API: the dependency, the import and the .use, because `.` and dbModule are its own", async () => {
      const { orm } = await dbModules();
      const patches = orm.variant.patch ?? [];

      // `dbModule` is what `{{SCOPE}}/db` serves at its root, and the root export is orm's: db/d1 alone
      // exports `./d1`, so the API has nothing to `.use()` until orm is installed.
      expect(await ormText("packages/db/src/index.ts")).toMatch(
        /export \{[^}]*\bdbModule\b[^}]*\} from "\.\/module"/,
      );
      expect(mergedInto(patches, "packages/db/package.json").exports).toMatchObject({
        ".": "./src/index.ts",
      });
      expect(dependenciesPatch(patches, "apps/api/package.json")).toEqual({
        dependencies: { "{{SCOPE}}/db": "workspace:*" },
        devDependencies: {},
      });
      expect(patches.filter((patch) => patch.file === "apps/api/src/app.ts")).toMatchObject([
        { type: "ts.addImport", moduleSpecifier: "{{SCOPE}}/db", namedImports: ["dbModule"] },
        { type: "ts.elysiaUse", targetName: "app", argument: "dbModule" },
      ]);
    });

    describe("installed over the API shell, in one call or each module alone", () => {
      const NO_ITEMS = { items: [], npmDependencies: [], npmDevDependencies: [] };
      const REFS = [
        { category: "provider", id: "cloudflare" },
        { category: "config", id: "branding" },
        { category: "api", id: "elysia" },
        { category: "db", id: "d1" },
        { category: "orm", id: "drizzle" },
      ] as const;
      const WIRED = ["apps/api/package.json", "apps/api/src/app.ts", "packages/db/package.json"];

      /** Every file of a project, `bg.json` without the time it was written. */
      async function tree(root: string): Promise<Record<string, string>> {
        const files: Record<string, string> = {};
        for await (const path of new Bun.Glob("**/*").scan({
          cwd: root,
          dot: true,
          onlyFiles: true,
        })) {
          const text = await readFile(join(root, path), "utf8");
          files[path] = path === "bg.json" ? text.replace(/"installedAt": "[^"]*"/g, "") : text;
        }
        return files;
      }

      // `@app` sorts before `@elysiajs/*` and `@zz` after it, so `{{SCOPE}}/db` lands in different places.
      test.each(["@app", "@zz"])(
        "scope %s: every patch applies, the three files are what the formatter writes, and a re-add moves nothing",
        async (scope) => {
          const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
          const root = await mkdtemp(join(tmpdir(), "bg-wired-"));
          try {
            await writeFile(
              join(root, "package.json"),
              '{\n  "name": "p",\n  "private": true,\n  "workspaces": ["apps/*", "packages/*"]\n}\n',
            );
            const manifest = createEmptyProjectManifest({ scope, registries: {} });
            const plans = await resolveModulePlans(catalog, [...REFS], manifest);

            const first = await applyInstallPlan({
              projectRoot: root,
              manifest,
              plan: NO_ITEMS,
              modules: plans,
              sourceLabel: "@bg",
            });

            expect(
              first.patches
                .filter(({ status }) => status !== "applied")
                .map(({ module, type, reason }) => ({ module, type, reason })),
            ).toEqual([]);
            const orm = first.patches.filter(({ module }) => module === "orm/drizzle");
            expect(orm.map(({ type, file }) => `${type} ${file}`)).toEqual([
              "jsonc.merge packages/db/package.json",
              "package.dependencies packages/db/package.json",
              "scripts.merge packages/db/package.json",
              "package.dependencies apps/api/package.json",
              "ts.addImport apps/api/src/app.ts",
              "ts.elysiaUse apps/api/src/app.ts",
            ]);

            const app = await readFile(join(root, "apps/api/src/app.ts"), "utf8");
            expect(app).toContain(`import { dbModule } from "${scope}/db";\n`);
            // Between the last `.use` of the shell and its routes.
            expect(app).toMatch(/\)\n {2}\.use\(dbModule\)\n {2}\/\/ Insertion point/s);
            const api: unknown = JSON.parse(
              await readFile(join(root, "apps/api/package.json"), "utf8"),
            );
            expect(
              isRecord(api) && isRecord(api.dependencies) ? api.dependencies[`${scope}/db`] : null,
            ).toBe("workspace:*");

            const written = Object.fromEntries(
              await Promise.all(
                WIRED.map(
                  async (path) => [path, await readFile(join(root, path), "utf8")] as const,
                ),
              ),
            );
            await expect(formatWithProjectFormatter(written)).resolves.toEqual(written);

            // The one-call record is what each module alone would leave: re-adding any of them changes nothing.
            const before = await tree(root);
            for (const ref of REFS) {
              const [alone] = await resolveModulePlans(catalog, [ref], first.manifest);
              if (alone === undefined) {
                throw new Error(`no plan for ${ref.category}/${ref.id}`);
              }
              const again = await applyInstallPlan({
                projectRoot: root,
                manifest: first.manifest,
                plan: NO_ITEMS,
                modules: [alone],
                sourceLabel: "@bg",
              });
              expect(again.patches.filter(({ status }) => status !== "skipped")).toEqual([]);
              expect(await tree(root)).toEqual(before);
            }
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        },
      );
    });
  });

  test("every patch a variant declares is one the CLI applies, with arguments it accepts", async () => {
    const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
    const refused: string[] = [];

    for (const { manifest } of catalog.modules) {
      for (const variant of manifest.variants) {
        try {
          plannedPatches(`${manifest.category}/${manifest.id}`, variant, "@acme");
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
