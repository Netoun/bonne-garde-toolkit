import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createEmptyProjectManifest,
  parseProjectManifest,
  type ModuleCategory,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { loadLocalRegistry } from "./load-registry";
import { classifyNames, resolveModulePlans } from "./module-plan";
import type { RegistryCatalog } from "./types";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

type ModuleSpec = {
  category: ModuleCategory;
  id: string;
  /** Everything in `module.json` but `id`, `category`, `title` and `description`. */
  json?: Record<string, unknown>;
  /** Files under `template/`, by path. */
  template?: Record<string, string>;
};

async function write(path: string, content: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
}

/** A registry on disk: items inline in `registry.json`, modules as `modules/<category>/<id>/`. */
async function registry(modules: ModuleSpec[], itemNames: string[] = []): Promise<RegistryCatalog> {
  const root = await mkdtemp(join(tmpdir(), "bg-modplan-"));
  dirs.push(root);
  await write(
    join(root, "registry.json"),
    JSON.stringify({
      name: "test",
      items: itemNames.map((name) => ({ name, type: "registry:lib" })),
    }),
  );
  for (const { category, id, json, template } of modules) {
    const dir = join(root, "modules", category, id);
    await write(
      join(dir, "module.json"),
      JSON.stringify({
        id,
        category,
        title: id,
        description: `${id} module`,
        variants: [{ key: "default", match: {} }],
        ...json,
      }),
    );
    for (const [path, content] of Object.entries(template ?? {})) {
      await write(join(dir, "template", path), content);
    }
  }
  return loadLocalRegistry(join(root, "registry.json"));
}

function project(
  installed: Partial<Record<ModuleCategory, string[]>> = {},
  scope = "@demo",
): ProjectManifest {
  const modules = Object.fromEntries(
    Object.entries(installed).map(([category, ids]) => [
      category,
      ids.map((id) => ({
        id,
        variant: "default",
        version: "0.1.0",
        installedAt: "2026-01-01T00:00:00.000Z",
        options: {},
        patches: [],
        intentions: { applied: [], skipped: {} },
      })),
    ]),
  );
  return parseProjectManifest({
    ...createEmptyProjectManifest({ scope, registries: {} }),
    modules,
  });
}

const CLOUDFLARE: ModuleSpec = { category: "provider", id: "cloudflare" };
const DOCKERFILE: ModuleSpec = { category: "provider", id: "dockerfile" };

describe("classifyNames (050 step 3)", () => {
  test("a bare module id is a module, a bare item name is an item, order kept", async () => {
    const catalog = await registry([CLOUDFLARE], ["button", "card"]);

    expect(classifyNames(catalog, ["button", "cloudflare", "card"])).toEqual({
      items: ["button", "card"],
      modules: [{ category: "provider", id: "cloudflare" }],
    });
  });

  test("<category>/<id> names a module, the same string the files record uses as owner", async () => {
    const catalog = await registry([CLOUDFLARE]);

    expect(classifyNames(catalog, ["provider/cloudflare"]).modules).toEqual([
      { category: "provider", id: "cloudflare" },
    ]);
  });

  test("asking for the same module twice, bare and qualified, plans it once", async () => {
    const catalog = await registry([CLOUDFLARE]);

    expect(classifyNames(catalog, ["cloudflare", "provider/cloudflare"]).modules).toHaveLength(1);
  });

  test("a bare id that exists in two categories is refused, naming both qualified forms", async () => {
    const catalog = await registry([
      { category: "db", id: "sqlite" },
      { category: "orm", id: "sqlite" },
    ]);

    expect(() => classifyNames(catalog, ["sqlite"])).toThrow(/db\/sqlite.*orm\/sqlite/s);
  });

  test("a bare name that is both an item and a module is refused, not resolved to one of them", async () => {
    const catalog = await registry([{ category: "email", id: "resend" }], ["resend"]);

    expect(() => classifyNames(catalog, ["resend"])).toThrow(
      /both an item and a module.*email\/resend/s,
    );
  });

  test("an unknown name fails with suggestions from both catalogs", async () => {
    const catalog = await registry([CLOUDFLARE], ["cloud-button"]);

    expect(() => classifyNames(catalog, ["cloud"])).toThrow(
      /unknown name: cloud.*cloud-button.*provider\/cloudflare/s,
    );
  });

  test("an unknown module in a known category lists that category's modules", async () => {
    const catalog = await registry([CLOUDFLARE, DOCKERFILE]);

    expect(() => classifyNames(catalog, ["provider/vercel"])).toThrow(
      /unknown module: provider\/vercel.*provider\/cloudflare.*provider\/dockerfile/s,
    );
  });

  test("an unknown category is named as such", async () => {
    const catalog = await registry([CLOUDFLARE]);

    expect(() => classifyNames(catalog, ["runtime/cloudflare"])).toThrow(
      /unknown category: runtime/,
    );
  });
});

describe("resolveModulePlans: peers (050 step 4)", () => {
  const AUTH: ModuleSpec = {
    category: "auth",
    id: "better-auth",
    json: { peers: { db: ["d1", "libsql"], orm: [] } },
  };

  test("a missing peer category fails listing the category and its allow-list, before reading any file", async () => {
    const catalog = await registry([AUTH]);

    await expect(
      resolveModulePlans(catalog, [{ category: "auth", id: "better-auth" }], project()),
    ).rejects.toThrow(
      /auth\/better-auth needs a module in category db \(d1 \| libsql\) and none is installed/,
    );
  });

  test("an empty allow-list means any module of that category, but one has to exist", async () => {
    const catalog = await registry([AUTH]);

    await expect(
      resolveModulePlans(
        catalog,
        [{ category: "auth", id: "better-auth" }],
        project({ db: ["d1"] }),
      ),
    ).rejects.toThrow(/needs a module in category orm \(any\) and none is installed/);
  });

  test("a peer outside the allow-list fails naming the incompatible module", async () => {
    const catalog = await registry([AUTH]);

    await expect(
      resolveModulePlans(
        catalog,
        [{ category: "auth", id: "better-auth" }],
        project({ db: ["postgres"], orm: ["drizzle"] }),
      ),
    ).rejects.toThrow(
      /auth\/better-auth accepts only d1 \| libsql for db, but db\/postgres is present/,
    );
  });

  test("installed peers satisfy it", async () => {
    const catalog = await registry([AUTH]);

    const plans = await resolveModulePlans(
      catalog,
      [{ category: "auth", id: "better-auth" }],
      project({ db: ["d1"], orm: ["drizzle"] }),
    );

    expect(plans.map((p) => p.key)).toEqual(["auth/better-auth"]);
  });

  test("a peer requested in the same call satisfies it, and is planned first", async () => {
    const catalog = await registry([
      AUTH,
      { category: "db", id: "d1" },
      { category: "orm", id: "drizzle" },
    ]);

    const plans = await resolveModulePlans(
      catalog,
      [
        { category: "auth", id: "better-auth" },
        { category: "orm", id: "drizzle" },
        { category: "db", id: "d1" },
      ],
      project(),
    );

    expect(plans.map((p) => p.key)).toEqual(["db/d1", "orm/drizzle", "auth/better-auth"]);
  });
});

describe("resolveModulePlans: cardinality (050 step 5)", () => {
  test("a filled `one` category fails naming the installed module and pointing at bg replace", async () => {
    const catalog = await registry([CLOUDFLARE, DOCKERFILE]);

    await expect(
      resolveModulePlans(
        catalog,
        [{ category: "provider", id: "dockerfile" }],
        project({ provider: ["cloudflare"] }),
      ),
    ).rejects.toThrow(
      /provider is already filled by provider\/cloudflare.*bg replace provider\/dockerfile/s,
    );
  });

  test("two modules of one `one` category in one call fail before anything is planned", async () => {
    const catalog = await registry([CLOUDFLARE, DOCKERFILE]);

    await expect(
      resolveModulePlans(
        catalog,
        [
          { category: "provider", id: "cloudflare" },
          { category: "provider", id: "dockerfile" },
        ],
        project(),
      ),
    ).rejects.toThrow(
      /provider admits one module, but this call names provider\/cloudflare and provider\/dockerfile/,
    );
  });

  test("the module already filling its category is a re-add, not a conflict", async () => {
    const catalog = await registry([CLOUDFLARE]);

    const plans = await resolveModulePlans(
      catalog,
      [{ category: "provider", id: "cloudflare" }],
      project({ provider: ["cloudflare"] }),
    );

    expect(plans.map((p) => p.key)).toEqual(["provider/cloudflare"]);
  });

  test("a `many` category takes several modules", async () => {
    const catalog = await registry([
      { category: "web", id: "spa" },
      { category: "web", id: "ssr" },
    ]);

    const plans = await resolveModulePlans(
      catalog,
      [
        { category: "web", id: "ssr" },
        { category: "web", id: "spa" },
      ],
      project({ web: ["static"] }),
    );

    expect(plans.map((p) => p.key)).toEqual(["web/ssr", "web/spa"]);
  });
});

describe("resolveModulePlans: options (050 step 6)", () => {
  test("options resolve to their defaults, and a module with none records an empty object", async () => {
    const catalog = await registry([
      {
        category: "auth",
        id: "better-auth",
        json: {
          options: {
            withOrg: { default: false, values: [true, false] },
            region: { default: "eu" },
          },
        },
      },
      CLOUDFLARE,
    ]);

    const plans = await resolveModulePlans(
      catalog,
      [
        { category: "provider", id: "cloudflare" },
        { category: "auth", id: "better-auth" },
      ],
      project({}),
    );

    expect(plans.find((p) => p.id === "cloudflare")?.options).toEqual({});
    expect(plans.find((p) => p.id === "better-auth")?.options).toEqual({
      withOrg: false,
      region: "eu",
    });
  });
});

describe("resolveModulePlans: variant (050 step 7)", () => {
  const VARIANTS = [
    { key: "default", match: {} },
    { key: "on-cloudflare", match: { provider: "cloudflare" } },
    { key: "on-cloudflare-d1", match: { provider: "cloudflare", db: "d1" } },
    { key: "on-dockerfile", match: { provider: "dockerfile" } },
  ];
  const STORAGE: ModuleSpec = { category: "storage", id: "files", json: { variants: VARIANTS } };

  async function variantFor(installed: Partial<Record<ModuleCategory, string[]>>): Promise<string> {
    const catalog = await registry([STORAGE]);
    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "storage", id: "files" }],
      project(installed),
    );
    return plan?.variant ?? "";
  }

  test("the most specific match satisfied by the installed peers wins", async () => {
    expect(await variantFor({ provider: ["cloudflare"], db: ["d1"] })).toBe("on-cloudflare-d1");
    expect(await variantFor({ provider: ["cloudflare"], db: ["libsql"] })).toBe("on-cloudflare");
    expect(await variantFor({ provider: ["dockerfile"] })).toBe("on-dockerfile");
  });

  test("the default variant is the fallback when nothing more specific matches", async () => {
    expect(await variantFor({})).toBe("default");
  });

  test("a peer installed in the same call counts as installed", async () => {
    const catalog = await registry([STORAGE, CLOUDFLARE]);

    const plans = await resolveModulePlans(
      catalog,
      [
        { category: "storage", id: "files" },
        { category: "provider", id: "cloudflare" },
      ],
      project(),
    );

    expect(plans.find((p) => p.id === "files")?.variant).toBe("on-cloudflare");
  });

  test("no matching variant fails listing the installed peers and the match keys on offer", async () => {
    const catalog = await registry([
      {
        category: "storage",
        id: "files",
        json: {
          variants: [
            { key: "cf", match: { provider: "cloudflare" } },
            { key: "docker", match: { provider: "dockerfile" } },
          ],
        },
      },
    ]);

    await expect(
      resolveModulePlans(catalog, [{ category: "storage", id: "files" }], project({ db: ["d1"] })),
    ).rejects.toThrow(
      /no variant of storage\/files matches.*installed: db=d1.*cf \{provider=cloudflare\}.*docker \{provider=dockerfile\}/s,
    );
  });

  test("two equally specific variants both satisfied is an authoring error, never a pick", async () => {
    const catalog = await registry([
      {
        category: "storage",
        id: "files",
        json: {
          variants: [
            { key: "by-db", match: { db: "d1" } },
            { key: "by-orm", match: { orm: "drizzle" } },
          ],
        },
      },
    ]);

    await expect(
      resolveModulePlans(
        catalog,
        [{ category: "storage", id: "files" }],
        project({ db: ["d1"], orm: ["drizzle"] }),
      ),
    ).rejects.toThrow(/by-db and by-orm are equally specific/);
  });
});

describe("resolveModulePlans: the plan (050 step 8)", () => {
  test("copies every file the globs match, from template/, with dotfiles, in sorted order", async () => {
    const catalog = await registry([
      {
        category: "provider",
        id: "docker",
        json: {
          variants: [
            {
              key: "default",
              match: {},
              copy: ["Dockerfile", ".dockerignore", "packages/rt/**"],
            },
          ],
        },
        template: {
          Dockerfile: "FROM bun\n",
          ".dockerignore": ".git\n",
          "packages/rt/src/index.ts": "export {};\n",
          "packages/rt/src/deep/more.ts": "export {};\n",
          "unlisted.txt": "no glob names me\n",
        },
      },
    ]);

    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "provider", id: "docker" }],
      project(),
    );

    expect(plan?.files.map((f) => f.target)).toEqual([
      ".dockerignore",
      "Dockerfile",
      "packages/rt/src/deep/more.ts",
      "packages/rt/src/index.ts",
    ]);
    expect(plan?.files.find((f) => f.target === "Dockerfile")?.content).toBe("FROM bun\n");
  });

  test("a file matched by two globs is planned once", async () => {
    const catalog = await registry([
      {
        category: "provider",
        id: "docker",
        json: { variants: [{ key: "default", match: {}, copy: ["a/**", "a/x.txt"] }] },
        template: { "a/x.txt": "x" },
      },
    ]);

    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "provider", id: "docker" }],
      project(),
    );

    expect(plan?.files.map((f) => f.target)).toEqual(["a/x.txt"]);
  });

  test("renders {{SCOPE}} with the project's scope", async () => {
    const catalog = await registry([
      {
        category: "provider",
        id: "docker",
        json: { variants: [{ key: "default", match: {}, copy: ["Dockerfile"] }] },
        template: { Dockerfile: "RUN bun run --filter '{{SCOPE}}/spa' build\n" },
      },
    ]);

    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "provider", id: "docker" }],
      project({}, "@shop"),
    );

    expect(plan?.files[0]?.content).toBe("RUN bun run --filter '@shop/spa' build\n");
  });

  test("a glob that matches nothing fails, naming the glob", async () => {
    const catalog = await registry([
      {
        category: "provider",
        id: "docker",
        json: { variants: [{ key: "default", match: {}, copy: ["nope/**"] }] },
        template: { "a.txt": "a" },
      },
    ]);

    await expect(
      resolveModulePlans(catalog, [{ category: "provider", id: "docker" }], project()),
    ).rejects.toThrow(/copy "nope\/\*\*" of provider\/docker matches no file under template\//);
  });

  test("carries env keys, dependencies, checks, and defaults a missing `required` to false", async () => {
    const catalog = await registry([
      {
        category: "auth",
        id: "better-auth",
        json: {
          checks: ["bun run typecheck"],
          variants: [
            {
              key: "default",
              match: {},
              workspace: { name: "{{SCOPE}}/auth", path: "packages/auth" },
              dependencies: { "better-auth": "1.4.2" },
              devDependencies: { typescript: "7.0.2" },
              env: [{ name: "SECRET", required: true, example: "x" }, { name: "OPTIONAL" }],
              copy: ["packages/auth/src/index.ts"],
            },
          ],
        },
        template: { "packages/auth/src/index.ts": "export {};\n" },
      },
    ]);

    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "auth", id: "better-auth" }],
      project(),
    );

    expect(plan?.env).toEqual([
      { name: "SECRET", required: true, example: "x" },
      { name: "OPTIONAL", required: false, example: "" },
    ]);
    expect(plan?.dependencies).toEqual({ "better-auth": "1.4.2" });
    expect(plan?.devDependencies).toEqual({ typescript: "7.0.2" });
    expect(plan?.checks).toEqual(["bun run typecheck"]);
  });

  test("declared dependencies are written into a generated workspace package.json", async () => {
    const catalog = await registry([
      {
        category: "auth",
        id: "better-auth",
        json: {
          version: "0.2.0",
          variants: [
            {
              key: "default",
              match: {},
              workspace: { name: "{{SCOPE}}/auth", path: "packages/auth" },
              dependencies: { "better-auth": "1.4.2" },
              devDependencies: { typescript: "7.0.2" },
              copy: ["packages/auth/src/index.ts"],
            },
          ],
        },
        template: { "packages/auth/src/index.ts": "export {};\n" },
      },
    ]);

    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "auth", id: "better-auth" }],
      project({}, "@shop"),
    );

    expect(plan?.workspace).toBe("packages/auth");
    const generated = plan?.files.find((f) => f.target === "packages/auth/package.json");
    expect(JSON.parse(generated?.content ?? "null")).toEqual({
      name: "@shop/auth",
      version: "0.2.0",
      private: true,
      type: "module",
      dependencies: { "better-auth": "1.4.2" },
      devDependencies: { typescript: "7.0.2" },
    });
  });

  test("dependencies with no workspace to hold them fail instead of landing nowhere", async () => {
    const catalog = await registry([
      {
        category: "auth",
        id: "better-auth",
        json: {
          variants: [{ key: "default", match: {}, dependencies: { "better-auth": "1.4.2" } }],
        },
      },
    ]);

    await expect(
      resolveModulePlans(catalog, [{ category: "auth", id: "better-auth" }], project()),
    ).rejects.toThrow(/declares dependencies but no workspace package/);
  });

  test("a variant that also vendors the package.json it generates is refused (035)", async () => {
    const catalog = await registry([
      {
        category: "auth",
        id: "better-auth",
        json: {
          variants: [
            {
              key: "default",
              match: {},
              workspace: { name: "{{SCOPE}}/auth", path: "packages/auth" },
              dependencies: { "better-auth": "1.4.2" },
              copy: ["packages/auth/**"],
            },
          ],
        },
        template: { "packages/auth/package.json": "{}\n" },
      },
    ]);

    await expect(
      resolveModulePlans(catalog, [{ category: "auth", id: "better-auth" }], project()),
    ).rejects.toThrow(/both vendors packages\/auth\/package.json and generates it/);
  });
});

describe("resolveModulePlans: what is not supported yet fails loudly", () => {
  const withVariant = (extra: Record<string, unknown>) =>
    registry([
      {
        category: "api",
        id: "elysia",
        json: { variants: [{ key: "default", match: {}, ...extra }] },
      },
    ]);

  test("a patch is refused, naming it, never skipped", async () => {
    const catalog = await withVariant({
      patch: [{ type: "ts.elysiaUse", file: "apps/api/src/app.ts", argument: "authModule" }],
    });

    await expect(
      resolveModulePlans(catalog, [{ category: "api", id: "elysia" }], project()),
    ).rejects.toThrow(
      /api\/elysia declares patch ts\.elysiaUse on apps\/api\/src\/app\.ts: patches are not supported yet/,
    );
  });

  test("an intention is refused, since nothing would stage it", async () => {
    const catalog = await withVariant({ intent: ["01-wire.md"] });

    await expect(
      resolveModulePlans(catalog, [{ category: "api", id: "elysia" }], project()),
    ).rejects.toThrow(
      /api\/elysia declares intentions \(01-wire\.md\): staging them is not supported yet/,
    );
  });

  test("a variant that is not selected may declare both", async () => {
    const catalog = await registry([
      {
        category: "api",
        id: "elysia",
        json: {
          variants: [
            { key: "default", match: {} },
            {
              key: "docker",
              match: { provider: "dockerfile" },
              patch: [{ type: "ts.elysiaUse", file: "a.ts" }],
              intent: ["01-wire.md"],
            },
          ],
        },
      },
    ]);

    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "api", id: "elysia" }],
      project({ provider: ["cloudflare"] }),
    );

    expect(plan?.variant).toBe("default");
  });
});
