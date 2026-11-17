import { describe, expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { loadLocalRegistry, patchRegions, plannedPatches } from "../packages/registry/src/index";
import {
  addArguments,
  assetPath,
  AUTH_TABLES,
  buildsImage,
  CONFIGURATIONS,
  type Configuration,
  countStatement,
  d1Rows,
  diffTrees,
  dockerDecision,
  dockerName,
  dockerSkipReason,
  EXCLUDED,
  EXCLUDED_MODULES,
  expectedPortlessApps,
  expectedTables,
  expectGenerated,
  expectIntentRegion,
  expectKept,
  expectMigrated,
  expectNoIntentRegion,
  expectNothingToApply,
  expectPatches,
  expectPortlessPlan,
  expectPeerRefusal,
  expectRan,
  expectRefusal,
  FEATURE_ITEMS,
  expectRegenerated,
  expectRows,
  expectAlreadySeeded,
  expectSeeded,
  expectRegionsRecorded,
  expectServed,
  GOLDEN_BARREL_LINE,
  GOLDEN_MEDIA_STATEMENT,
  GOLDEN_NOTE_STATEMENT,
  GOLDEN_TABLE,
  AUTH_MIN_TESTS,
  EMAIL_MIN_TESTS,
  expectPending,
  hasAuth,
  hasDatabase,
  hasEmail,
  hasPortless,
  MAILER_FILE,
  PENDING,
  PORTLESS_MIN_TESTS,
  readPendingIntentions,
  RESOLUTIONS,
  wiredTest,
  wireEmailIntoAuth,
  hasStorage,
  intentRegion,
  WITHOUT_ORM,
  MODULE_TABLES,
  MODULES,
  PATCHED,
  publishedPort,
  ranTests,
  hasFeatures,
  readAddedItems,
  readAddedModules,
  readKept,
  readCounts,
  resetTables,
  SEEDED_ADMIN,
  REFUSED_FEATURE,
  requiresDocker,
  SCOPE,
  selectItems,
  selectModules,
  spaMinTests,
  SPA_FEATURE_MIN_TESTS,
  SPA_SHELL_MIN_TESTS,
  STORAGE_MIN_TESTS,
  testCounts,
  until,
  DEPLOY_MODULE,
  DEPLOY_PLAN,
  expectDeployableApp,
  expectDeployPlan,
  expectEveryAppPlanned,
  expectProviderRefusal,
  expectWorkflow,
  hasDeploy,
  readDeployPlan,
  refusesDeploy,
  type AddedModule,
} from "./golden-project";

const LISTING = [
  "utils\tregistry:lib\tcn() helper for className merging.",
  "button\tregistry:ui\tPrimary button component.",
  "portless\tregistry:lib\tNamed local HTTPS URLs.",
  "",
].join("\n");

describe("selectItems", () => {
  test("takes the first tab-separated column of every line", () => {
    expect(selectItems(LISTING, {})).toEqual({
      items: ["utils", "button", "portless"],
      excluded: [],
    });
  });

  test("keeps an excluded item out of the install list and reports why", () => {
    const { items, excluded } = selectItems(LISTING, { button: "needs a consumer app" });
    expect(items).toEqual(["utils", "portless"]);
    expect(excluded).toEqual([{ name: "button", reason: "needs a consumer app" }]);
  });

  test("tolerates a description with no tab and a name with trailing spaces", () => {
    expect(selectItems("utils \nbutton\tregistry:ui\n", {}).items).toEqual(["utils", "button"]);
  });

  test("fails when an exclusion names an item the registry no longer lists", () => {
    expect(() => selectItems(LISTING, { ghost: "was removed" })).toThrow(/ghost/);
  });

  test("fails when the listing is empty, so a broken `bg list` is not a green run", () => {
    expect(() => selectItems("\n", {})).toThrow(/no items/);
  });

  test("fails when every listed item is excluded", () => {
    expect(() => selectItems("utils\tregistry:lib\tx\n", { utils: "nope" })).toThrow(/no items/);
  });
});

describe("the golden project", () => {
  test("installs every item the registry lists", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.items.map((item) => `${item.name}\t${item.type}`).join("\n");

    expect(selectItems(listing, EXCLUDED).items).toContain("button");
  });

  test("installs the feature items too, with the other items: nothing is left out", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.items.map((item) => `${item.name}\t${item.type}`).join("\n");

    const { items, excluded } = selectItems(listing, EXCLUDED);

    expect(EXCLUDED).toEqual({});
    expect(excluded).toEqual([]);
    expect(items).toEqual(expect.arrayContaining([...FEATURE_ITEMS]));
    // The item `refuse` tries without any module is one of them.
    expect(FEATURE_ITEMS).toContain(REFUSED_FEATURE);
  });

  test("the feature items are every item that lands in an app's features folder", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );

    expect(
      catalog.items
        .filter((item) =>
          (item.files ?? []).some((file) =>
            /^apps\/[^/]+\/src\/features\//.test(file.target ?? ""),
          ),
        )
        .map((item) => item.name),
    ).toEqual([...FEATURE_ITEMS]);
  });

  test("a configuration has features when it installs the items and has the auth module they need", () => {
    const [cloudflare, dockerfile] = CONFIGURATIONS;
    expect(hasFeatures(cloudflare as Configuration)).toBe(true);
    expect(hasFeatures(dockerfile as Configuration)).toBe(false);
  });

  test("the spa runs the shell's tests everywhere, and the features' too where they are installed", () => {
    const [cloudflare, dockerfile] = CONFIGURATIONS;
    expect(spaMinTests(dockerfile as Configuration)).toBe(SPA_SHELL_MIN_TESTS);
    expect(spaMinTests(cloudflare as Configuration)).toBe(
      SPA_SHELL_MIN_TESTS + SPA_FEATURE_MIN_TESTS,
    );
  });

  test("uses a scope that is not `@acme`'s length, which the registry is formatted with", () => {
    expect(SCOPE).toMatch(/^@[a-z0-9-]+$/);
    expect(SCOPE.length).not.toBe("@acme".length);
  });
});

const FULL_LISTING = [
  LISTING.trimEnd(),
  "provider/cloudflare\tmodule\tWorkers runtime.",
  "provider/dockerfile\tmodule\tOne Bun container.",
  "tooling/vite-plus\tmodule\tVite+ lint and fmt.",
  "",
].join("\n");

describe("selectModules", () => {
  const exclusions = {
    "provider/cloudflare": "one provider per project",
    "provider/dockerfile": "one provider per project",
  };

  test("takes the module lines of `bg list` and skips the items", () => {
    expect(selectModules(FULL_LISTING, ["tooling/vite-plus"], exclusions)).toEqual({
      modules: ["tooling/vite-plus"],
      excluded: [
        { name: "provider/cloudflare", reason: "one provider per project" },
        { name: "provider/dockerfile", reason: "one provider per project" },
      ],
    });
  });

  test("installs the modules in the order it was given, not the order `bg list` printed", () => {
    const { modules } = selectModules(FULL_LISTING, ["tooling/vite-plus", "provider/cloudflare"], {
      "provider/dockerfile": "one provider per project",
    });
    expect(modules).toEqual(["tooling/vite-plus", "provider/cloudflare"]);
  });

  test("fails on a module that is neither installed nor excluded, and says what to do", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus"], { "provider/cloudflare": "x" }),
    ).toThrow(/provider\/dockerfile.*install.*exclude/s);
  });

  test("fails on an installed module that `bg list` does not show", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus", "tooling/ghost"], exclusions),
    ).toThrow(/tooling\/ghost/);
  });

  test("fails on an exclusion for a module the registry no longer lists", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus"], { ...exclusions, "auth/ghost": "gone" }),
    ).toThrow(/auth\/ghost/);
  });

  test("fails on a module that is both installed and excluded", () => {
    expect(() =>
      selectModules(FULL_LISTING, ["tooling/vite-plus", "provider/cloudflare"], exclusions),
    ).toThrow(/provider\/cloudflare.*both/s);
  });

  test("fails when nothing is installed, so a broken `bg list` is not a green run", () => {
    expect(() => selectModules(LISTING, [], {})).toThrow(/no modules/);
  });
});

describe("readAddedModules", () => {
  const output = JSON.stringify({
    dryRun: false,
    items: ["utils"],
    modules: [
      { module: "tooling/vite-plus", variant: "default", checks: ["bun run check"], files: [] },
      { module: "provider/cloudflare", variant: "default", files: [] },
    ],
    written: [],
  });

  test("reads each module's key and its checks, none when it declares none", () => {
    expect(readAddedModules(output, ["tooling/vite-plus"])).toEqual([
      { module: "tooling/vite-plus", checks: ["bun run check"], patches: [] },
      { module: "provider/cloudflare", checks: [], patches: [] },
    ]);
  });

  test("fails when `bg add` did not report a module golden asked for", () => {
    expect(() => readAddedModules(output, ["tooling/vite-plus", "db/d1"])).toThrow(/db\/d1/);
  });

  test("fails on output that is not the JSON `bg add` prints", () => {
    expect(() => readAddedModules("not json", [])).toThrow(/bg add/);
    expect(() => readAddedModules("{}", [])).toThrow(/modules/);
    expect(() => readAddedModules('{"modules":[{"module":"a/b","checks":[1]}]}', [])).toThrow(
      /checks/,
    );
  });
});

describe("the golden project and modules", () => {
  test("every module the registry lists is installed or left out with a reason", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.modules
      .map(({ manifest }) => `${manifest.category}/${manifest.id}\tmodule\t${manifest.description}`)
      .join("\n");

    const { modules } = selectModules(listing, MODULES, EXCLUDED_MODULES);

    expect(modules).toEqual([
      "provider/cloudflare",
      "tooling/vite-plus",
      "config/branding",
      "ui/shadcn",
      "api/elysia",
      "db/d1",
      "orm/drizzle",
      "auth/better-auth",
      "storage/r2",
      "web/spa",
      "web/ssr",
      "web/static",
      "dev/portless",
      "email/resend",
      "deploy/cloudflare-actions",
      "provider/dockerfile",
    ]);
  });

  test("each configuration has one provider, and every provider the registry has is in one", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const providers = catalog.modules
      .filter(({ manifest }) => manifest.category === "provider")
      .map(({ manifest }) => `provider/${manifest.id}`);

    const used = CONFIGURATIONS.map(({ modules }) =>
      modules.filter((name) => name.startsWith("provider/")),
    );
    expect(used.every((names) => names.length === 1)).toBe(true);
    expect([...new Set(used.flat())].sort()).toEqual([...providers].sort());
    expect(Object.keys(EXCLUDED_MODULES)).toEqual([]);
  });

  test("only the configuration with a ui module installs items, which land in packages/ui", () => {
    for (const { modules, items } of CONFIGURATIONS) {
      if (items) {
        expect(modules).toContain("ui/shadcn");
      }
    }
    // The dockerfile configuration installs the ui module and no item: the image the Dockerfile has to build.
    expect(CONFIGURATIONS.find(({ name }) => name === "dockerfile")?.items).toBe(false);
  });

  test("no item golden installs shares its bare name with a module: `bg add` refuses a name that is both", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.items.map((item) => `${item.name}\t${item.type}`).join("\n");
    const moduleIds = catalog.modules.map(({ manifest }) => manifest.id);

    expect(selectItems(listing, EXCLUDED).items.filter((name) => moduleIds.includes(name))).toEqual(
      [],
    );
  });
});

describe("addArguments", () => {
  test("is one `bg add`: the modules, then every item, with --yes and --no-install", () => {
    expect(addArguments(["tooling/vite-plus", "ui/shadcn"], ["utils", "button"])).toEqual([
      "add",
      "tooling/vite-plus",
      "ui/shadcn",
      "utils",
      "button",
      "--yes",
      "--no-install",
    ]);
  });

  test("never passes --force: a collision between two installs must fail the run", () => {
    expect(addArguments(MODULES, ["utils", "button"])).not.toContain("--force");
  });

  test("fails when a name is given twice, since a second mention hides a gap in a list", () => {
    expect(() => addArguments(["ui/shadcn"], ["button", "button"])).toThrow(/button/);
    expect(() => addArguments(["ui/shadcn"], ["ui/shadcn"])).toThrow(/ui\/shadcn/);
  });

  test("fails with no module, so an empty `bg list` is not a green run", () => {
    expect(() => addArguments([], ["button"])).toThrow(/no modules/);
  });

  test("takes no items, for a configuration that installs modules only; selectItems refuses an empty `bg list`", () => {
    expect(addArguments(["api/elysia"], [])).toEqual([
      "add",
      "api/elysia",
      "--yes",
      "--no-install",
    ]);
    expect(() => selectItems("", {})).toThrow(/no items/);
  });

  test("golden installs the ui module that every UI item needs, in the same call as the items", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );
    const listing = catalog.items.map((item) => `${item.name}\t${item.type}`).join("\n");

    const argv = addArguments(
      CONFIGURATIONS[0]?.modules ?? [],
      selectItems(listing, EXCLUDED).items,
    );

    expect(argv).toContain("ui/shadcn");
    expect(argv).toContain("button");
    expect(argv.indexOf("ui/shadcn")).toBeLessThan(argv.indexOf("button"));
  });
});

describe("expectRefusal", () => {
  const stderr =
    "button needs the ui module, and none is installed or named in this call; run: bg add ui/shadcn button\n";

  test("passes when the add failed and the message gives the command that fixes it", () => {
    expect(() => expectRefusal({ code: 1, stderr }, "button", "ui/shadcn")).not.toThrow();
  });

  test("fails when the add succeeded: an item with no host module must not install", () => {
    expect(() => expectRefusal({ code: 0, stderr: "" }, "button", "ui/shadcn")).toThrow(
      /succeeded/,
    );
  });

  test("fails when it was refused for another reason, and says what it printed", () => {
    expect(() =>
      expectRefusal({ code: 1, stderr: "unknown name: button\n" }, "button", "ui/shadcn"),
    ).toThrow(/bg add ui\/shadcn button.*unknown name: button/s);
  });

  test("a feature item in a bare project is refused for every module it needs, named in one command (030)", () => {
    const all =
      "spa-auth needs the ui, auth and web/spa modules, and none is installed or named in this call; run: bg add ui/shadcn auth/better-auth web/spa spa-auth\n";

    expect(() =>
      expectRefusal(
        { code: 1, stderr: all },
        "spa-auth",
        "ui/shadcn",
        "auth/better-auth",
        "web/spa",
      ),
    ).not.toThrow();
    // A fix that leaves a module out is not the fix.
    expect(() => expectRefusal({ code: 1, stderr: all }, "spa-auth", "ui/shadcn")).toThrow(
      /bg add ui\/shadcn spa-auth/,
    );
  });

  test("a project missing one module is refused for that one alone", () => {
    const storage =
      "spa-backoffice needs the storage module, and none is installed or named in this call; run: bg add storage/r2 spa-backoffice\n";

    expect(() =>
      expectRefusal({ code: 1, stderr: storage }, "spa-backoffice", "storage/r2"),
    ).not.toThrow();
    expect(() =>
      expectRefusal({ code: 1, stderr: storage }, "spa-backoffice", "auth/better-auth"),
    ).toThrow(/bg add auth\/better-auth spa-backoffice/);
  });
});

describe("readAddedItems: the dependencies an item added (030)", () => {
  const patch = {
    item: "spa-auth",
    type: "package.dependencies",
    file: "apps/spa/package.json",
    status: "applied",
    regions: [{ region: "dependencies.zod", status: "applied" }],
  };

  test("reads each item's patches, as the modules' are, so one check covers both", () => {
    const items = readAddedItems(JSON.stringify({ items: ["spa-auth"], itemPatches: [patch] }));

    expect(items).toEqual([
      {
        module: "spa-auth",
        checks: [],
        patches: [
          {
            type: "package.dependencies",
            file: "apps/spa/package.json",
            status: "applied",
            regions: [{ region: "dependencies.zod", status: "applied" }],
          },
        ],
      },
    ]);
    expect(() =>
      expectPatches(items, "applied", { "spa-auth": ["dependencies.zod"] }),
    ).not.toThrow();
    expect(() => expectPatches(items, "skipped", { "spa-auth": ["dependencies.zod"] })).toThrow(
      /was applied/,
    );
  });

  test("an item that adds nothing is no entry, and a missing list is a failed run", () => {
    expect(readAddedItems(JSON.stringify({ items: ["button"], itemPatches: [] }))).toEqual([]);
    expect(() => readAddedItems(JSON.stringify({ items: [] }))).toThrow(/itemPatches/);
    expect(() => readAddedItems("not json")).toThrow(/did not print JSON/);
  });

  test("an item that patches a file but is not in PATCHED_ITEMS is a decision golden has not made", () => {
    const items = readAddedItems(JSON.stringify({ itemPatches: [patch] }));

    expect(() => expectPatches(items, "applied", {})).toThrow(/not in PATCHED/);
  });
});

describe("readAddedModules: patches", () => {
  const patch = {
    type: "scripts.merge",
    file: "package.json",
    status: "applied",
    regions: [{ region: "scripts.gen:branding", status: "applied" }],
  };

  test("reads each patch with its status, reason and regions", () => {
    const output = JSON.stringify({
      modules: [
        { module: "config/branding", checks: [], patches: [patch] },
        {
          module: "x/y",
          patches: [{ ...patch, status: "failed", reason: "no file", regions: [] }],
        },
      ],
    });

    expect(readAddedModules(output, []).map(({ patches }) => patches)).toEqual([
      [patch],
      [
        {
          type: "scripts.merge",
          file: "package.json",
          status: "failed",
          reason: "no file",
          regions: [],
        },
      ],
    ]);
  });

  test("fails on a patch that is not what `bg add` prints", () => {
    expect(() =>
      readAddedModules(
        JSON.stringify({ modules: [{ module: "a/b", patches: [{ type: 1 }] }] }),
        [],
      ),
    ).toThrow(/patch/);
    expect(() =>
      readAddedModules(JSON.stringify({ modules: [{ module: "a/b", patches: "none" }] }), []),
    ).toThrow(/patches/);
  });
});

describe("expectPatches (060: a failed patch is never silent, and a re-add skips every one)", () => {
  const module = (
    status: string,
    regions: string[],
    more: Partial<AddedModule["patches"][number]> = {},
  ) => ({
    module: "config/branding",
    checks: [],
    patches: [
      {
        type: "scripts.merge",
        file: "package.json",
        status,
        regions: regions.map((region) => ({ region, status })),
        ...more,
      },
    ],
  });
  const expected = { "config/branding": ["scripts.gen:branding"] };

  test("passes when each module's patch did `status` to the regions golden expects", () => {
    expect(() =>
      expectPatches([module("applied", ["scripts.gen:branding"])], "applied", expected),
    ).not.toThrow();
    expect(() =>
      expectPatches([module("skipped", ["scripts.gen:branding"])], "skipped", expected),
    ).not.toThrow();
  });

  test("fails on a failed patch, with its reason", () => {
    expect(() =>
      expectPatches(
        [module("failed", [], { reason: "package.json does not exist" })],
        "applied",
        expected,
      ),
    ).toThrow(/failed.*package\.json does not exist/s);
  });

  test("fails when the status is not the one asked for, as an `applied` on a re-add", () => {
    expect(() =>
      expectPatches([module("applied", ["scripts.gen:branding"])], "skipped", expected),
    ).toThrow(/config\/branding.*applied.*skipped/s);
  });

  test("fails when a module that should patch reports none, or other regions", () => {
    expect(() =>
      expectPatches([{ module: "config/branding", checks: [], patches: [] }], "applied", expected),
    ).toThrow(/config\/branding.*scripts\.gen:branding/s);
    expect(() =>
      expectPatches([module("applied", ["scripts.other"])], "applied", expected),
    ).toThrow(/scripts\.other/);
  });

  test("fails on a patch from a module golden does not know patches", () => {
    expect(() =>
      expectPatches([module("applied", ["scripts.gen:branding"])], "applied", {}),
    ).toThrow(/config\/branding.*not.*PATCHED/s);
  });
});

describe("the golden project and patches", () => {
  test("PATCHED names, per configuration, the modules whose selected variant declares a patch, and the regions it writes", async () => {
    const catalog = await loadLocalRegistry(
      join(resolve(import.meta.dir, ".."), "registry/registry.json"),
    );

    for (const { name, modules } of CONFIGURATIONS) {
      // What `bg add` does: among the variants whose `match` the configuration satisfies, the most specific.
      const regions: Record<string, string[]> = {};
      for (const { manifest } of catalog.modules) {
        if (!modules.includes(`${manifest.category}/${manifest.id}`)) {
          continue;
        }
        const satisfied = manifest.variants.filter((variant) =>
          Object.entries(variant.match).every(([category, id]) =>
            modules.includes(`${category}/${id}`),
          ),
        );
        const [variant] = satisfied.sort(
          (a, b) => Object.keys(b.match).length - Object.keys(a.match).length,
        );
        // The regions the engine says the declared patches write, `{{SCOPE}}` rendered at golden's scope.
        const key = `${manifest.category}/${manifest.id}`;
        const written = (variant === undefined ? [] : plannedPatches(key, variant, SCOPE)).flatMap(
          (patch) => patchRegions(patch).map(({ region }) => region),
        );
        if ((variant?.patch ?? []).length > 0) {
          regions[`${manifest.category}/${manifest.id}`] = written.sort();
        }
      }

      // A module that gains a patch is a decision made in golden, as a module that is not installed is.
      expect({ [name]: PATCHED[name] }).toEqual({ [name]: regions });
    }
    expect(Object.keys(PATCHED).sort()).toEqual(CONFIGURATIONS.map(({ name }) => name).sort());
    expect(PATCHED).toEqual({
      cloudflare: {
        "config/branding": ["scripts.gen:branding"],
        "api/elysia": ["scripts.deploy", "scripts.dev"],
        "db/d1": [
          "d1_databases",
          "env.production.d1_databases",
          "scripts.db:migrate:local",
          "scripts.db:migrate:remote",
        ],
        "auth/better-auth": [
          "dependencies.@app/auth",
          "dependencies.@app/auth",
          "elysia[app].use[authModule]",
          "exports[@app/auth/schema]",
          "imports[@app/auth]",
        ],
        "storage/r2": [
          "dependencies.@app/storage",
          "dependencies.@app/storage",
          "elysia[app].use[mediaModule]",
          "env.production.r2_buckets",
          "env.production.vars.R2_PUBLIC_URL",
          "exports[@app/storage/schema]",
          "imports[@app/storage]",
          "r2_buckets",
          "vars.R2_PUBLIC_URL",
        ],
        "orm/drizzle": [
          "dependencies.@app/db",
          "dependencies.drizzle-orm",
          "dependencies.elysia",
          "devDependencies.drizzle-kit",
          "elysia[app].use[dbModule]",
          'exports."."',
          'exports."./reset"',
          'exports."./schema"',
          'exports."./testing"',
          "imports[@app/db]",
          "scripts.db:generate",
          "scripts.db:reset",
          "scripts.db:studio",
        ],
        "web/spa": ["env.production.vars.API_URL", "scripts.deploy", "scripts.dev", "vars.API_URL"],
        "web/ssr": ["env.production.vars.API_URL", "scripts.deploy", "scripts.dev", "vars.API_URL"],
        "web/static": ["scripts.deploy", "scripts.dev"],
        "dev/portless": [
          "devDependencies.portless",
          "scripts.dev:lan:portless",
          "scripts.dev:portless",
        ],
        // The import into mailer.ts is the intention's: the file an intention edits is region-checked
        // by the `intent[<id>]` region `bg record` leaves, not by a patch that imports for it.
        "email/resend": ["dependencies.@app/email"],
        "deploy/cloudflare-actions": ["scripts.deploy:cloudflare"],
      },
      dockerfile: {
        "config/branding": ["scripts.gen:branding"],
        "api/elysia": ["scripts.dev"],
        "web/spa": ["scripts.dev"],
        "dev/portless": [
          "devDependencies.portless",
          "scripts.dev:lan:portless",
          "scripts.dev:portless",
        ],
      },
      fronts: {
        "config/branding": ["scripts.gen:branding"],
        "web/spa": ["scripts.deploy", "scripts.dev"],
        "web/ssr": ["scripts.deploy", "scripts.dev"],
        "web/static": ["scripts.deploy", "scripts.dev"],
        "dev/portless": [
          "devDependencies.portless",
          "scripts.dev:lan:portless",
          "scripts.dev:portless",
        ],
        "deploy/cloudflare-actions": ["scripts.deploy:cloudflare"],
      },
    });
  });
});

describe("diffTrees (a re-add leaves the project the same bytes)", () => {
  const manifest = (installedAt: string, status: string) =>
    `{\n  "installedAt": "${installedAt}",\n  "patches": [{ "status": "${status}" }]\n}\n`;

  test("is empty for equal trees, and for a bg.json that moved only installedAt", () => {
    const before = { "a.ts": "x", "bg.json": manifest("2026-01-01T00:00:00.000Z", "applied") };
    const after = { "a.ts": "x", "bg.json": manifest("2026-01-02T00:00:00.000Z", "applied") };

    expect(diffTrees(before, after)).toEqual([]);
  });

  test("names a bg.json whose recorded patch status moved: a re-add must not flip it", () => {
    const before = { "bg.json": manifest("2026-01-01T00:00:00.000Z", "applied") };
    const after = { "bg.json": manifest("2026-01-01T00:00:00.000Z", "skipped") };

    expect(diffTrees(before, after)).toEqual(["bg.json changed"]);
  });

  test("names a changed, an added and a removed file", () => {
    expect(diffTrees({ a: "1", b: "1", c: "1" }, { a: "2", b: "1", d: "1" })).toEqual([
      "a changed",
      "c removed",
      "d added",
    ]);
  });

  test("names a bg.json that changed in anything else", () => {
    const before = { "bg.json": '{ "files": {} }' };

    expect(diffTrees(before, { "bg.json": '{ "files": { "a": 1 } }' })).toEqual([
      "bg.json changed",
    ]);
  });
});

describe("expectRegionsRecorded (bg.json carries what `bg add` reported)", () => {
  const added: AddedModule[] = [
    {
      module: "config/branding",
      checks: [],
      patches: [
        {
          type: "scripts.merge",
          file: "package.json",
          status: "applied",
          regions: [{ region: "scripts.gen:branding", status: "applied" }],
        },
      ],
    },
  ];

  test("passes when bg.json records each region for the module that reported it", () => {
    const manifest = { regions: { "package.json": { "scripts.gen:branding": "config/branding" } } };

    expect(() => expectRegionsRecorded(manifest, added)).not.toThrow();
  });

  test("fails when a region is missing from bg.json, or recorded for someone else", () => {
    expect(() => expectRegionsRecorded({ regions: {} }, added)).toThrow(
      /scripts\.gen:branding of package\.json/,
    );
    expect(() =>
      expectRegionsRecorded(
        { regions: { "package.json": { "scripts.gen:branding": "dev/other" } } },
        added,
      ),
    ).toThrow(/dev\/other/);
  });

  test("fails on a bg.json that is not an object with regions", () => {
    expect(() => expectRegionsRecorded("nope", added)).toThrow(/regions/);
  });
});

describe("buildsImage (golden builds the image of the configuration that ships a Dockerfile)", () => {
  test("is the dockerfile configuration and no other", () => {
    expect(
      CONFIGURATIONS.filter((configuration) => buildsImage(configuration)).map(({ name }) => name),
    ).toEqual(["dockerfile"]);
  });
});

describe("the deploy phases (what golden proves of deploy/cloudflare-actions with no account and no network)", () => {
  const cloudflare = CONFIGURATIONS.find(({ name }) => name === "cloudflare");
  const dockerfile = CONFIGURATIONS.find(({ name }) => name === "dockerfile");

  test("the cloudflare configurations install the module, and the dockerfile one has to refuse it", () => {
    expect(CONFIGURATIONS.filter(hasDeploy).map(({ name }) => name)).toEqual([
      "cloudflare",
      "fronts",
    ]);
    expect(CONFIGURATIONS.filter(refusesDeploy).map(({ name }) => name)).toEqual(["dockerfile"]);
    // Every configuration either installs it or is checked to refuse it: none is left unexamined.
    for (const configuration of CONFIGURATIONS) {
      expect(hasDeploy(configuration) !== refusesDeploy(configuration)).toBe(true);
    }
    expect(dockerfile?.modules).not.toContain(DEPLOY_MODULE);
  });

  test("DEPLOY_PLAN is the ordered plan of each configuration that installs it, and follows from the modules installed", () => {
    expect(Object.keys(DEPLOY_PLAN)).toEqual(
      CONFIGURATIONS.filter(hasDeploy).map(({ name }) => name),
    );
    expect(DEPLOY_PLAN.cloudflare).toEqual([
      "build apps/api: bun run build",
      "build apps/spa: bun run build",
      "build apps/ssr: bun run build",
      "build apps/static: bun run build",
      "migrate apps/api: bun run db:migrate:remote --env production",
      "deploy apps/api: bun run deploy --env production",
      "deploy apps/spa: bun run deploy --project-name my-app-spa --branch main",
      "deploy apps/ssr: bun run deploy --env production",
      "deploy apps/static: bun run deploy --project-name my-app-static --branch main",
    ]);
    // One build and one deploy per app module of the configuration, and a migration because it has db/d1.
    const modules = cloudflare?.modules ?? [];
    const apps = modules.flatMap((name) =>
      name === "api/elysia" || name.startsWith("web/") ? [name.split("/")[1] ?? ""] : [],
    );
    const apiApp = (id: string) => (id === "elysia" ? "api" : id);
    const plan = DEPLOY_PLAN.cloudflare ?? [];
    for (const id of apps.map(apiApp)) {
      expect(plan.filter((step) => step.startsWith(`build apps/${id}:`))).toHaveLength(1);
      expect(plan.filter((step) => step.startsWith(`deploy apps/${id}:`))).toHaveLength(1);
    }
    expect(plan.filter((step) => step.startsWith("migrate "))).toHaveLength(
      modules.includes("db/d1") ? 1 : 0,
    );
    expect(plan).toHaveLength(apps.length * 2 + 1);
  });

  describe("readDeployPlan (what `bun run deploy:cloudflare --dry-run` prints)", () => {
    const printed = JSON.stringify({
      environment: "production",
      buildVars: ["VITE_API_URL"],
      steps: [
        { phase: "build", app: "api", cwd: "apps/api", argv: ["bun", "run", "build"] },
        {
          phase: "deploy",
          app: "api",
          cwd: "apps/api",
          argv: ["bun", "run", "deploy", "--env", "production"],
        },
        { phase: "build", app: "spa", cwd: "apps/spa", argv: ["bun", "run", "build"] },
      ],
    });

    test("reads each step as `<phase> <cwd>: <command>`, the apps once each in order, and the variable names", () => {
      expect(readDeployPlan(printed)).toEqual({
        steps: [
          "build apps/api: bun run build",
          "deploy apps/api: bun run deploy --env production",
          "build apps/spa: bun run build",
        ],
        apps: ["apps/api", "apps/spa"],
        buildVars: ["VITE_API_URL"],
      });
    });

    test("fails on what is not a plan, and says what it printed", () => {
      expect(() => readDeployPlan("deploy: nothing to deploy")).toThrow(
        /not JSON.*nothing to deploy/s,
      );
      expect(() => readDeployPlan("[]")).toThrow(/steps/);
      expect(() =>
        readDeployPlan(JSON.stringify({ steps: [{ phase: "build" }], buildVars: [] })),
      ).toThrow(/step/);
    });
  });

  describe("expectDeployPlan", () => {
    const expected = [
      "build apps/api: bun run build",
      "deploy apps/api: bun run deploy --env production",
    ];

    test("passes the same list in the same order", () => {
      expect(() => expectDeployPlan(expected, expected)).not.toThrow();
    });

    test("fails a different order, a missing step and an extra one, naming the first difference", () => {
      expect(() => expectDeployPlan([...expected].reverse(), expected)).toThrow(
        /step 1.*deploy apps\/api/s,
      );
      expect(() => expectDeployPlan(expected.slice(0, 1), expected)).toThrow(/step 2.*missing/s);
      expect(() =>
        expectDeployPlan([...expected, "deploy apps/x: bun run deploy"], expected),
      ).toThrow(/step 3.*deploy apps\/x/s);
    });
  });

  describe("expectDeployableApp (every app the script would deploy has a wrangler config it can deploy from)", () => {
    const wrangler = `{ // a Worker
      "name": "my-app-api",
      "main": "src/index.ts",
      "env": { "production": { "name": "my-app-api", }, },
    }`;
    const manifest = JSON.stringify({ scripts: { deploy: "wrangler deploy" } });

    test("passes a JSONC config with a name and a production environment, and a deploy script", () => {
      expect(() => expectDeployableApp("apps/api", wrangler, manifest)).not.toThrow();
    });

    test("fails a missing config, a config that is not JSONC, and one with no name or no production environment", () => {
      expect(() => expectDeployableApp("apps/api", undefined, manifest)).toThrow(
        /apps\/api.*wrangler\.jsonc/s,
      );
      expect(() => expectDeployableApp("apps/api", "{ nope", manifest)).toThrow(
        /apps\/api.*JSONC/s,
      );
      expect(() =>
        expectDeployableApp("apps/api", `{ "env": { "production": {} } }`, manifest),
      ).toThrow(/apps\/api.*name/s);
      expect(() => expectDeployableApp("apps/api", `{ "name": "x" }`, manifest)).toThrow(
        /apps\/api.*env\.production/s,
      );
    });

    test("fails a missing package.json and one with no deploy script", () => {
      expect(() => expectDeployableApp("apps/api", wrangler, undefined)).toThrow(
        /apps\/api.*package\.json/s,
      );
      expect(() =>
        expectDeployableApp("apps/api", wrangler, JSON.stringify({ scripts: {} })),
      ).toThrow(/apps\/api.*deploy script/s);
    });
  });

  describe("expectEveryAppPlanned (an app with a wrangler config that the plan leaves out is a deploy nobody asked to skip)", () => {
    test("passes when the apps with a config are the apps in the plan", () => {
      expect(() =>
        expectEveryAppPlanned(["apps/api", "apps/spa"], ["apps/spa", "apps/api"]),
      ).not.toThrow();
    });

    test("fails an app with a config that is not planned, and a planned app with no config", () => {
      expect(() => expectEveryAppPlanned(["apps/api"], ["apps/api", "apps/ssr"])).toThrow(
        /apps\/ssr.*not planned/s,
      );
      expect(() => expectEveryAppPlanned(["apps/api", "apps/x"], ["apps/api"])).toThrow(
        /apps\/x.*no wrangler/s,
      );
    });
  });

  describe("expectWorkflow (deploy.yml, as installed, against the project's own scripts)", () => {
    const real = async () =>
      Bun.file(
        join(
          resolve(import.meta.dir, ".."),
          "registry/modules/deploy/cloudflare-actions/template/.github/workflows/deploy.yml",
        ),
      ).text();
    const scripts = ["check", "typecheck", "test", "deploy:cloudflare"];

    test("passes the workflow the module ships, in a project with the scripts it runs", async () => {
      const workflow = await real();

      expect(() => expectWorkflow(workflow, scripts)).not.toThrow();
    });

    test("fails a script the project does not have, naming it", async () => {
      const workflow = await real();

      expect(() => expectWorkflow(workflow, ["check", "typecheck", "deploy:cloudflare"])).toThrow(
        /bun run test/,
      );
    });

    test("fails a workflow that is not YAML, one that runs on push, and one with no deploy job", async () => {
      const workflow = await real();

      expect(() => expectWorkflow("jobs: [", scripts)).toThrow(/YAML/);
      expect(() =>
        expectWorkflow(workflow.replace("on: workflow_dispatch", "on: push"), scripts),
      ).toThrow(/workflow_dispatch/);
      expect(() =>
        expectWorkflow("on: workflow_dispatch\njobs:\n  validate:\n    steps: []\n", scripts),
      ).toThrow(/deploy/);
    });

    test("fails a deploy job that does not run the script the project has for it", async () => {
      const workflow = await real();

      expect(() =>
        expectWorkflow(
          workflow.replace("run: bun run deploy:cloudflare\n", "run: wrangler deploy\n"),
          scripts,
        ),
      ).toThrow(/deploy:cloudflare/);
    });
  });

  describe("expectProviderRefusal (035: a peer outside the allow-list names the incompatible module)", () => {
    const stderr =
      "deploy/cloudflare-actions accepts only cloudflare for provider, but provider/dockerfile is present\n";

    test("passes a refusal that names the module, the provider it accepts and the one installed", () => {
      expect(() =>
        expectProviderRefusal(
          { code: 1, stderr },
          "deploy/cloudflare-actions",
          "cloudflare",
          "dockerfile",
        ),
      ).not.toThrow();
    });

    test("fails an install that succeeded, and a refusal that does not name the installed provider", () => {
      expect(() =>
        expectProviderRefusal(
          { code: 0, stderr: "" },
          "deploy/cloudflare-actions",
          "cloudflare",
          "dockerfile",
        ),
      ).toThrow(/succeeded.*dockerfile/s);
      expect(() =>
        expectProviderRefusal(
          { code: 1, stderr: "deploy/cloudflare-actions accepts only cloudflare for provider\n" },
          "deploy/cloudflare-actions",
          "cloudflare",
          "dockerfile",
        ),
      ).toThrow(/provider\/dockerfile/);
      expect(() =>
        expectProviderRefusal(
          { code: 1, stderr: "deploy/cloudflare-actions: no variant matches\n" },
          "deploy/cloudflare-actions",
          "cloudflare",
          "dockerfile",
        ),
      ).toThrow(/accepts only cloudflare/);
    });
  });
});

describe("dockerSkipReason (only the absence of docker skips the image; a failing build is a failed run)", () => {
  test("runs when docker is on PATH and `docker info` succeeds", () => {
    expect(dockerSkipReason({ code: 0, stderr: "" })).toBeNull();
  });

  test("skips, and says why, when docker is not on PATH", () => {
    expect(dockerSkipReason(null)).toBe("docker unavailable: not on PATH");
  });

  test("skips, and says why, when the daemon does not answer `docker info`", () => {
    expect(dockerSkipReason({ code: 1, stderr: "Cannot connect to the Docker daemon" })).toBe(
      "docker unavailable: `docker info` exited with 1",
    );
  });
});

describe("requiresDocker (GOLDEN_REQUIRE_DOCKER: CI must not skip the image phases without anyone noticing)", () => {
  test("is off when the variable is unset, empty, 0 or false, so a local run is unchanged", () => {
    for (const value of [undefined, "", "0", "false"]) {
      expect(requiresDocker(value)).toBe(false);
    }
  });

  test("is on for any other value, so a spelling like `true` or `yes` does not quietly turn it off", () => {
    for (const value of ["1", "true", "yes"]) {
      expect(requiresDocker(value)).toBe(true);
    }
  });
});

describe("dockerDecision (skip when docker is unavailable, or fail when it is required)", () => {
  const up = { code: 0, stderr: "" };
  const down = { code: 1, stderr: "Cannot connect to the Docker daemon" };

  test("runs when docker is available, required or not", () => {
    expect(dockerDecision(up, false)).toBeNull();
    expect(dockerDecision(up, true)).toBeNull();
  });

  test("skips with the reason when docker is unavailable and not required", () => {
    expect(dockerDecision(null, false)).toBe("docker unavailable: not on PATH");
    expect(dockerDecision(down, false)).toBe("docker unavailable: `docker info` exited with 1");
  });

  test("fails, naming the reason and the variable, when docker is unavailable and required", () => {
    expect(() => dockerDecision(null, true)).toThrow(
      /docker unavailable: not on PATH.*GOLDEN_REQUIRE_DOCKER/s,
    );
    expect(() => dockerDecision(down, true)).toThrow(
      /`docker info` exited with 1.*GOLDEN_REQUIRE_DOCKER/s,
    );
  });
});

describe("dockerName (one name for the image, the container and the volume of a run)", () => {
  test("is bg-golden-<pid>, so two runs on one machine do not meet", () => {
    expect(dockerName(4242)).toBe("bg-golden-4242");
    expect(dockerName(4242)).not.toBe(dockerName(4243));
  });
});

describe("publishedPort (what `docker port <name> 5172/tcp` prints)", () => {
  test("reads the host port of one binding", () => {
    expect(publishedPort("127.0.0.1:49153\n")).toBe(49153);
  });

  test("reads the first binding when docker prints an IPv6 one as well", () => {
    expect(publishedPort("0.0.0.0:49153\n[::]:49153\n")).toBe(49153);
  });

  test("fails on output with no binding, which is a container that published nothing", () => {
    expect(() => publishedPort("")).toThrow(/port/);
    expect(() => publishedPort("no public port '5172/tcp' published\n")).toThrow(/port/);
  });
});

describe("expectServed (what a response has to be: a status and a media type, whatever its parameters)", () => {
  test("passes on the status and the media type, with or without a charset", () => {
    expect(() =>
      expectServed("GET /", { status: 200, contentType: "text/html" }, 200, "text/html"),
    ).not.toThrow();
    expect(() =>
      expectServed(
        "GET /",
        { status: 200, contentType: "text/html;charset=utf-8" },
        200,
        "text/html",
      ),
    ).not.toThrow();
  });

  test("fails on another status, naming the request and what came back", () => {
    expect(() =>
      expectServed("GET /", { status: 404, contentType: "application/json" }, 200, "text/html"),
    ).toThrow(/GET \/.*200 text\/html.*404 application\/json/s);
  });

  test("fails on another media type, as an SPA fallback that answered JSON", () => {
    expect(() =>
      expectServed("GET /x", { status: 200, contentType: "application/json" }, 200, "text/html"),
    ).toThrow(/text\/html/);
  });

  test("fails on a response with no content type", () => {
    expect(() =>
      expectServed("GET /", { status: 200, contentType: null }, 200, "text/html"),
    ).toThrow(/no content type/);
  });
});

describe("assetPath (the hashed script the built index.html loads)", () => {
  test("reads the first /assets script of the page", () => {
    const html =
      '<link rel="stylesheet" href="/assets/root-aaa.css"><link rel="modulepreload" href="/assets/entry.client-BQ1.js"><script type="module" src="/assets/entry.client-BQ1.js"></script>';

    expect(assetPath(html)).toBe("/assets/entry.client-BQ1.js");
  });

  test("fails on a page that loads no script from /assets", () => {
    expect(() => assetPath("<html><body>hello</body></html>")).toThrow(/script/);
  });
});

describe("until (readiness is a bounded retry, not a fixed sleep)", () => {
  test("returns as soon as the check passes, and stops asking", async () => {
    let calls = 0;

    const ready = await until(async () => ++calls === 3, { timeoutMs: 2000, intervalMs: 1 });

    expect(ready).toBe(true);
    expect(calls).toBe(3);
  });

  test("gives up at the deadline, so a container that never answers fails the run", async () => {
    const start = performance.now();

    const ready = await until(async () => false, { timeoutMs: 50, intervalMs: 5 });

    expect(ready).toBe(false);
    expect(performance.now() - start).toBeLessThan(1000);
  });

  test("a check that throws is not ready yet, as a connection refused while the server starts", async () => {
    let calls = 0;

    const ready = await until(
      async () => {
        if (++calls < 2) {
          throw new Error("ECONNREFUSED");
        }
        return true;
      },
      { timeoutMs: 2000, intervalMs: 1 },
    );

    expect(ready).toBe(true);
  });
});

describe("the launcher phase (dev/portless)", () => {
  const SLUG = "golden-cloudflare";
  const frontCommand = (dir: string) => [
    "portless",
    "run",
    "--name",
    `${dir}.${SLUG}`,
    "bunx",
    "react-router",
    "dev",
  ];

  /** The JSON `bun scripts/dev-portless.ts --dry-run` prints, for the apps of the cloudflare configuration. */
  const printed = (tld: string, overrides: Record<string, Record<string, unknown>> = {}) => {
    const apiUrl = `https://api.${SLUG}.${tld}`;
    return JSON.stringify({
      slug: SLUG,
      lan: tld === "local",
      apps: expectedPortlessApps("cloudflare", SLUG, tld).map((app) => ({
        ...app,
        url: `https://${app.name}.${tld}`,
        cwd: `apps/${app.dir}`,
        // A Worker is told through `--var`, every other app through its environment.
        env: app.dir === "api" ? {} : { API_URL: apiUrl, VITE_API_URL: apiUrl },
        ...overrides[app.dir],
      })),
    });
  };

  test("every configuration installs the launcher, and it has tests to count", () => {
    expect(CONFIGURATIONS.filter(hasPortless).map(({ name }) => name)).toEqual([
      "cloudflare",
      "dockerfile",
      "fronts",
    ]);
    expect(PORTLESS_MIN_TESTS).toBeGreaterThan(0);
  });

  test("a project with a Worker API plans four apps, the API through wrangler with every sibling's URL", () => {
    const apps = expectedPortlessApps("cloudflare", SLUG, "localhost");

    expect(apps.map(({ dir }) => dir)).toEqual(["api", "spa", "ssr", "static"]);
    expect(apps[0]?.cmd).toEqual([
      "portless",
      "run",
      "--name",
      `api.${SLUG}`,
      "sh",
      "-c",
      'exec bunx wrangler dev --port "$PORT" "$@"',
      "wrangler",
      "--var",
      `API_URL:https://api.${SLUG}.localhost`,
      "--var",
      `R2_PUBLIC_URL:https://api.${SLUG}.localhost/v1/media/file`,
      "--var",
      `SPA_URL:https://spa.${SLUG}.localhost`,
      "--var",
      `SSR_URL:https://ssr.${SLUG}.localhost`,
      "--var",
      `STATIC_URL:https://static.${SLUG}.localhost`,
    ]);
    expect(apps.slice(1).map(({ cmd }) => cmd)).toEqual(["spa", "ssr", "static"].map(frontCommand));
  });

  test("a project on the dockerfile provider plans two apps, the API as a Bun process that reads PORT", () => {
    expect(expectedPortlessApps("dockerfile", "golden-dockerfile", "localhost")).toEqual([
      {
        dir: "api",
        name: "api.golden-dockerfile",
        cmd: [
          "portless",
          "run",
          "--name",
          "api.golden-dockerfile",
          "bun",
          "--watch",
          "src/index.ts",
        ],
      },
      {
        dir: "spa",
        name: "spa.golden-dockerfile",
        cmd: ["portless", "run", "--name", "spa.golden-dockerfile", "bunx", "react-router", "dev"],
      },
    ]);
  });

  test("a configuration golden does not know is refused, not planned as empty", () => {
    expect(() => expectedPortlessApps("netlify", "x", "localhost")).toThrow(/netlify/);
  });

  describe("expectPortlessPlan", () => {
    const expected = expectedPortlessApps("cloudflare", SLUG, "localhost");

    test("accepts the plan the launcher printed", () => {
      expect(() => expectPortlessPlan(printed("localhost"), expected, "localhost")).not.toThrow();
    });

    test("accepts the LAN plan, which serves every name under .local", () => {
      const lan = expectedPortlessApps("cloudflare", SLUG, "local");

      expect(() => expectPortlessPlan(printed("local"), lan, "local")).not.toThrow();
    });

    test("names an app the launcher did not plan", () => {
      const missing = JSON.stringify({
        slug: SLUG,
        lan: false,
        apps: JSON.parse(printed("localhost")).apps.slice(0, 3),
      });

      expect(() => expectPortlessPlan(missing, expected, "localhost")).toThrow(/static/);
    });

    test("names an app the launcher planned and golden did not expect", () => {
      expect(() =>
        expectPortlessPlan(printed("localhost"), expected.slice(0, 2), "localhost"),
      ).toThrow(/ssr/);
    });

    test("names the app whose command is another, and shows both", () => {
      const other = printed("localhost", {
        spa: { cmd: ["portless", "run", "bun", "run", "dev"] },
      });

      expect(() => expectPortlessPlan(other, expected, "localhost")).toThrow(/spa.*bun run dev/s);
    });

    test("names the app whose URL is not under the TLD the proxy serves", () => {
      const lan = printed("local");

      expect(() => expectPortlessPlan(lan, expected, "localhost")).toThrow(/api.*\.local/s);
    });

    test("fails when the launcher printed something that is not a plan", () => {
      expect(() => expectPortlessPlan("not json", expected, "localhost")).toThrow(/JSON/);
      expect(() => expectPortlessPlan('{"apps":3}', expected, "localhost")).toThrow(/apps/);
    });

    test("fails when an app that is not the API is not told where the API is", () => {
      const blind = printed("localhost", { spa: { env: {} } });
      const noVite = printed("localhost", {
        ssr: { env: { API_URL: `https://api.${SLUG}.localhost` } },
      });

      expect(() => expectPortlessPlan(blind, expected, "localhost")).toThrow(/spa.*API_URL/s);
      expect(() => expectPortlessPlan(noVite, expected, "localhost")).toThrow(/ssr.*VITE_API_URL/s);
    });
  });

  describe("ranTests", () => {
    test("reads the count from the line `bun test` prints on stderr", () => {
      expect(ranTests("\n 33 pass\n 0 fail\nRan 33 tests across 1 file. [557.00ms]\n")).toBe(33);
      expect(ranTests("Ran 1 test across 1 file.")).toBe(1);
    });

    test("fails when there is no such line, so a run that printed nothing is not a pass", () => {
      expect(() => ranTests("")).toThrow(/Ran/);
    });
  });
});

describe("the database phases", () => {
  test("a configuration has a database to generate and migrate when it installs the orm module", () => {
    expect(hasDatabase({ name: "a", modules: ["api/elysia", "orm/drizzle"], items: false })).toBe(
      true,
    );
    expect(hasDatabase({ name: "b", modules: ["api/elysia", "db/d1"], items: false })).toBe(false);
  });

  test("only the cloudflare configuration has one: db/d1 peers on that provider, and no dockerfile database exists", () => {
    expect(CONFIGURATIONS.filter(hasDatabase).map(({ name }) => name)).toEqual(["cloudflare"]);
    expect(CONFIGURATIONS.find(({ name }) => name === "dockerfile")?.modules).not.toContain(
      "db/d1",
    );
  });

  test("the table golden adds is exported from the barrel the way a module's tables are", () => {
    expect(GOLDEN_TABLE).toBe("golden_notes");
    expect(GOLDEN_BARREL_LINE).toBe('export { goldenNotes } from "./golden-notes";\n');
  });

  describe("expectGenerated", () => {
    const sql = "CREATE TABLE `golden_notes` (\n\t`id` integer PRIMARY KEY NOT NULL\n);\n";

    test("returns the one migration `db:generate` wrote, when it creates the table", () => {
      expect(expectGenerated(["0000_silly_multiple_man.sql", "meta"], sql, "golden_notes")).toBe(
        "0000_silly_multiple_man.sql",
      );
    });

    test("fails when nothing was generated: an empty schema writes no migration", () => {
      expect(() => expectGenerated(["meta"], sql, "golden_notes")).toThrow(/no migration/);
    });

    test("fails when the migration does not create the table", () => {
      expect(() => expectGenerated(["0000_x.sql"], "SELECT 1;", "golden_notes")).toThrow(
        /golden_notes/,
      );
    });

    test("fails on more than one, so a stale migration is not taken for the new one", () => {
      expect(() => expectGenerated(["0000_x.sql", "0001_y.sql"], sql, "golden_notes")).toThrow(
        /0000_x\.sql.*0001_y\.sql/s,
      );
    });
  });

  describe("d1Rows", () => {
    test("reads the rows of the one statement `wrangler d1 execute --json` ran", () => {
      const stdout = JSON.stringify([
        { results: [{ name: "notes" }], success: true, meta: { duration: 0 } },
      ]);

      expect(d1Rows(stdout)).toEqual([{ name: "notes" }]);
    });

    test("fails on a statement that did not succeed, and on output that is not that JSON", () => {
      expect(() => d1Rows(JSON.stringify([{ results: [], success: false }]))).toThrow(/success/);
      expect(() => d1Rows("not json")).toThrow(/JSON/);
      expect(() => d1Rows("[]")).toThrow(/statement/);
    });
  });

  describe("expectMigrated", () => {
    test("passes when the table exists and the migration is the one recorded as applied", () => {
      expect(() =>
        expectMigrated(
          { tables: ["d1_migrations", "golden_notes"], applied: ["0000_x.sql"] },
          "golden_notes",
          "0000_x.sql",
        ),
      ).not.toThrow();
    });

    test("fails when the table is not in the database", () => {
      expect(() =>
        expectMigrated(
          { tables: ["d1_migrations"], applied: ["0000_x.sql"] },
          "golden_notes",
          "0000_x.sql",
        ),
      ).toThrow(/golden_notes/);
    });

    test("fails when the migration is not recorded as applied: a table made another way proves nothing", () => {
      expect(() =>
        expectMigrated({ tables: ["golden_notes"], applied: [] }, "golden_notes", "0000_x.sql"),
      ).toThrow(/0000_x\.sql/);
    });
  });

  describe("expectNothingToApply", () => {
    test("passes on what wrangler prints when the database is up to date, fails on anything else", () => {
      expect(() => expectNothingToApply("✅ No migrations to apply!\n")).not.toThrow();
      expect(() => expectNothingToApply("Migrations to be applied:\n")).toThrow(/second run/);
    });
  });
});

describe("testCounts", () => {
  test("reads how many tests each workspace ran from the prefixed output of the root test script", () => {
    const output = [
      "@app/config:test      |  6 pass",
      "@app/config:test      | Ran 6 tests across 1 file. [5.00ms]",
      "@app/db:test          | Ran 12 tests across 4 files. [437.00ms]",
      "@app/ssr:test         |       Tests  4 passed (4)",
      "bun test v1.4.2",
    ].join("\n");

    expect(testCounts(output)).toEqual({ "@app/config": 6, "@app/db": 12, "@app/ssr": 4 });
  });
});

describe("the auth phases", () => {
  test("a configuration generates the auth schema again when it installs the auth module, and only the cloudflare one does", () => {
    expect(hasAuth({ name: "a", modules: ["api/elysia", "auth/better-auth"], items: false })).toBe(
      true,
    );
    expect(hasAuth({ name: "b", modules: ["api/elysia", "orm/drizzle"], items: false })).toBe(
      false,
    );
    expect(CONFIGURATIONS.filter(hasAuth).map(({ name }) => name)).toEqual(["cloudflare"]);
  });

  test("auth is installed after the db and the orm it peers on", () => {
    const modules = CONFIGURATIONS.find(({ name }) => name === "cloudflare")?.modules ?? [];

    expect(modules.indexOf("auth/better-auth")).toBeGreaterThan(modules.indexOf("orm/drizzle"));
  });

  describe("expectRegenerated", () => {
    const shipped = 'export const user = sqliteTable("user", {});\n';

    test("passes when the generator writes the shipped file again", () => {
      expect(() => expectRegenerated(shipped, shipped)).not.toThrow();
    });

    test("fails on the first line that differs, naming both: a hand edit the generator drops", () => {
      const edited = `${shipped}export const organizationSlug = uniqueIndex("organization_slug_uidx");\n`;

      expect(() => expectRegenerated(edited, shipped)).toThrow(
        /from line 2.*organization_slug_uidx/s,
      );
    });

    test("fails when the generated file is shorter or longer, with no line to name", () => {
      expect(() => expectRegenerated(shipped, `${shipped}export const extra = 1;\n`)).toThrow(
        /from line 2/,
      );
      expect(() => expectRegenerated(`${shipped}export const extra = 1;\n`, shipped)).toThrow(
        /from line 2/,
      );
    });
  });

  describe("expectPeerRefusal (035: a missing orm is named)", () => {
    const stderr =
      "auth/better-auth needs a module in category orm (drizzle) and none is installed\n";

    test("passes when the add failed and the message names the missing category", () => {
      expect(() => expectPeerRefusal({ code: 1, stderr }, "better-auth", "orm")).not.toThrow();
    });

    test("fails when the add succeeded", () => {
      expect(() => expectPeerRefusal({ code: 0, stderr: "" }, "better-auth", "orm")).toThrow(
        /succeeded/,
      );
    });

    test("fails when it was refused for another reason, and says what it printed", () => {
      expect(() =>
        expectPeerRefusal({ code: 1, stderr: "unknown name: better-auth\n" }, "better-auth", "orm"),
      ).toThrow(/category orm.*unknown name/s);
    });
  });

  describe("expectRan (the auth tests run in the project, not only in the registry)", () => {
    test("passes when the workspace ran at least the floor, and fails below it or when it is absent", () => {
      const counts = { "@app/auth": AUTH_MIN_TESTS, "@app/api": 33 };

      expect(() => expectRan(counts, "@app/auth", AUTH_MIN_TESTS)).not.toThrow();
      expect(() => expectRan(counts, "@app/auth", AUTH_MIN_TESTS + 1)).toThrow(
        new RegExp(`ran ${AUTH_MIN_TESTS} tests`),
      );
      expect(() => expectRan({ "@app/api": 33 }, "@app/auth", 1)).toThrow(/ran 0 tests/);
    });
  });

  describe("expectSeeded (db:seed leaves the admin once, and again after db:reset)", () => {
    const admin = [{ email: "admin@example.local", email_verified: 1 }];
    const owner = [{ role: "owner" }];

    test("passes on one verified admin who owns one organization", () => {
      expect(() => expectSeeded(admin, owner)).not.toThrow();
    });

    test("fails on no user, on a second one, and on another email: a seed that ran on top of rows", () => {
      expect(() => expectSeeded([], owner)).toThrow(/expected only/);
      expect(() => expectSeeded([...admin, ...admin], owner)).toThrow(/expected only/);
      expect(() => expectSeeded([{ email: "x@example.com", email_verified: 1 }], owner)).toThrow(
        /expected only/,
      );
    });

    test("fails on an unverified admin, who could not sign in", () => {
      expect(() =>
        expectSeeded([{ email: "admin@example.local", email_verified: 0 }], owner),
      ).toThrow(/not verified/);
    });

    test("fails when the admin is not the one owner", () => {
      expect(() => expectSeeded(admin, [])).toThrow(/one owner/);
      expect(() => expectSeeded(admin, [{ role: "member" }])).toThrow(/one owner/);
      expect(() => expectSeeded(admin, [...owner, ...owner])).toThrow(/one owner/);
    });
  });

  describe("expectAlreadySeeded (db:seed on a database that has the admin says so)", () => {
    test("passes on the line the seed prints for an admin that exists, and fails on the line of a first seed", () => {
      expect(() =>
        expectAlreadySeeded(
          "✅ No migrations to apply!\nAlready seeded: admin@example.local exists, so nothing was changed\n",
        ),
      ).not.toThrow();
      expect(() =>
        expectAlreadySeeded(
          "Seeded: admin@example.local / password123, owner of the Personal organization\n",
        ),
      ).toThrow(/changed nothing/);
    });
  });

  describe("the rows golden puts in D1 for db:reset to empty, and reads back", () => {
    const cloudflare = CONFIGURATIONS.find(({ name }) => name === "cloudflare");

    test("AUTH_TABLES is the tables the auth schema declares: a table it gains is one reset must empty", async () => {
      const schema = await Bun.file(
        join(
          resolve(import.meta.dir, ".."),
          "registry/modules/auth/better-auth/template/packages/auth/src/schema.ts",
        ),
      ).text();
      const declared = [...schema.matchAll(/sqliteTable\(\s*"([^"]+)"/g)].flatMap(([, name]) =>
        name === undefined ? [] : [name],
      );

      expect([...AUTH_TABLES].sort()).toEqual(declared.sort());
    });

    test("reset has to empty the auth tables, the one golden adds and each module's, and no more", () => {
      expect(cloudflare === undefined ? [] : resetTables(cloudflare)).toEqual([
        ...AUTH_TABLES,
        GOLDEN_TABLE,
        "medias",
      ]);
      expect(resetTables({ name: "a", modules: ["orm/drizzle"], items: false })).toEqual([
        GOLDEN_TABLE,
      ]);
    });

    test("the media it inserts has the admin as author and no organization, which is the row an organization cascade does not reach", () => {
      expect(GOLDEN_MEDIA_STATEMENT).toContain("INSERT INTO medias");
      expect(GOLDEN_MEDIA_STATEMENT).toContain("author_id");
      expect(GOLDEN_MEDIA_STATEMENT).not.toContain("organization");
      expect(GOLDEN_MEDIA_STATEMENT).toContain(SEEDED_ADMIN);
      expect(GOLDEN_NOTE_STATEMENT).toContain(GOLDEN_TABLE);
    });

    test("counts every table in one row, without a compound select (D1 allows five terms), and reads the counts back", () => {
      expect(countStatement(["user", "medias"])).toBe(
        `SELECT (SELECT count(*) FROM "user") AS "user", (SELECT count(*) FROM "medias") AS "medias"`,
      );
      expect(readCounts([{ user: 1, medias: 0 }])).toEqual({ user: 1, medias: 0 });
      expect(() => readCounts([{ user: "1" }])).toThrow(/no count/);
      expect(() => readCounts([])).toThrow(/one row/);
    });

    test("expectRows passes on the counts it expects, and names every table that differs, one it did not count too", () => {
      expect(() => expectRows({ user: 0, medias: 0 }, { user: 0, medias: 0 })).not.toThrow();
      expect(() => expectRows({ user: 1, medias: 0 }, { user: 0, medias: 0 })).toThrow(
        /user holds 1, expected 0/,
      );
      expect(() => expectRows({ user: 0 }, { user: 0, medias: 1 })).toThrow(
        /medias was not counted/,
      );
    });
  });

  test("the project the refusal runs in has every peer of auth but the orm", () => {
    expect(WITHOUT_ORM).toEqual(["provider/cloudflare", "config/branding", "api/elysia", "db/d1"]);
    expect(WITHOUT_ORM).not.toContain("orm/drizzle");
  });
});

describe("the email phases", () => {
  test("every configuration installs email, and only the one with auth has anything to wire", () => {
    expect(CONFIGURATIONS.filter(hasEmail).map(({ name }) => name)).toEqual([
      "cloudflare",
      "dockerfile",
    ]);
    expect(hasEmail({ name: "a", modules: ["api/elysia"], items: false })).toBe(false);
    // The dockerfile project has no db, so no auth: email installs there on its own, and cleanly.
    expect(CONFIGURATIONS.find(({ name }) => name === "dockerfile")?.modules).not.toContain(
      "auth/better-auth",
    );
  });

  test("the cloudflare configuration has auth and email, which wires itself into it", () => {
    const modules = CONFIGURATIONS.find(({ name }) => name === "cloudflare")?.modules ?? [];

    expect(modules).toContain("email/resend");
    expect(modules).toContain("auth/better-auth");
  });

  test("the floor of email tests is what the package has, so a package the root test skipped fails the run", async () => {
    const dir = join(resolve(import.meta.dir, ".."), "registry/modules/email/resend/template");
    let tests = 0;
    for await (const path of new Bun.Glob("packages/email/src/**/*.test.ts").scan({ cwd: dir })) {
      const text = await Bun.file(join(dir, path)).text();
      tests += [...text.matchAll(/^\s*(?:test|it)(?:\.each\([\s\S]*?\))?\(/gm)].length;
    }

    expect(EMAIL_MIN_TESTS).toBeGreaterThan(0);
    // `test.each` counts its rows at run time: the floor is what the project ran, never more than that.
    expect(tests).toBeGreaterThanOrEqual(EMAIL_MIN_TESTS - 2);
  });

  describe("PENDING (050 step 14: what `bg add` leaves for an executor, per configuration)", () => {
    test("is the intentions the selected variants ship, and golden knows how to resolve each", async () => {
      const root = resolve(import.meta.dir, "..");
      const catalog = await loadLocalRegistry(join(root, "registry/registry.json"));

      for (const { name, modules } of CONFIGURATIONS) {
        const shipped: string[] = [];
        for (const { manifest } of catalog.modules) {
          if (!modules.includes(`${manifest.category}/${manifest.id}`)) {
            continue;
          }
          const [variant] = manifest.variants
            .filter((candidate) =>
              Object.entries(candidate.match).every(([category, id]) =>
                modules.includes(`${category}/${id}`),
              ),
            )
            .sort((a, b) => Object.keys(b.match).length - Object.keys(a.match).length);
          for (const file of variant?.intent ?? []) {
            shipped.push(`${manifest.category}/${manifest.id}/${file.replace(/^\d+-|\.md$/g, "")}`);
          }
        }
        expect({ [name]: PENDING[name] }).toEqual({ [name]: shipped.sort() });
      }
      expect(PENDING).toEqual({
        cloudflare: ["email/resend/wire-email-into-auth"],
        dockerfile: [],
        fronts: [],
      });
      expect(Object.keys(RESOLUTIONS)).toEqual(["email/resend/wire-email-into-auth"]);
    });
  });

  describe("readPendingIntentions", () => {
    const out = (pendingIntentions: unknown) => JSON.stringify({ modules: [], pendingIntentions });

    test("reads the ids `bg add` printed, in order, and none when there are none", () => {
      expect(readPendingIntentions(out([{ id: "a/b/c" }, { id: "a/b/d" }]))).toEqual([
        "a/b/c",
        "a/b/d",
      ]);
      expect(readPendingIntentions(out([]))).toEqual([]);
    });

    test("fails on output that is not JSON, or has no list, or an entry with no id", () => {
      expect(() => readPendingIntentions("nope")).toThrow(/did not print JSON/);
      expect(() => readPendingIntentions("{}")).toThrow(/no `pendingIntentions` array/);
      expect(() => readPendingIntentions(out([{}]))).toThrow(/without an id/);
    });
  });

  describe("expectPending", () => {
    test("passes on the ids expected, in any order", () => {
      expect(() => expectPending(["b", "a"], ["a", "b"])).not.toThrow();
      expect(() => expectPending([], [])).not.toThrow();
    });

    test("fails on an intention nobody expected: a variant that gained one is a decision made in golden", () => {
      expect(() => expectPending(["a"], [])).toThrow(/pending \[a\], golden expects \[\]/);
    });

    test("fails on an expected one that is not pending: a wiring that never staged", () => {
      expect(() => expectPending([], ["a"])).toThrow(/pending \[\], golden expects \[a\]/);
    });
  });

  describe("wireEmailIntoAuth (the edit the intention describes, as an executor makes it)", () => {
    const before = [
      'import { logger as apiLogger } from "@app/api/lib/logger";',
      'import type { AuthLogger } from "./auth.config";',
      "",
      "export const mailer: AuthMailer = unconfiguredMailer(apiLogger);",
      "",
    ].join("\n");

    test("imports emailMailer in place of the logger only the old initializer used, and replaces the initializer of mailer", () => {
      expect(wireEmailIntoAuth(before, "@app")).toBe(
        [
          'import { emailMailer } from "@app/email";',
          'import type { AuthLogger } from "./auth.config";',
          "",
          "export const mailer: AuthMailer = emailMailer;",
          "",
        ].join("\n"),
      );
    });

    test("fails, naming what it looked for, when auth ships another seam: a stale edit is not applied", () => {
      expect(() => wireEmailIntoAuth("export const mailer = other;\n", "@app")).toThrow(
        /unconfiguredMailer\(apiLogger\)/,
      );
      expect(() =>
        wireEmailIntoAuth(before.replace("@app/api/lib/logger", "@other/api/lib/logger"), "@app"),
      ).toThrow(/@app\/api\/lib\/logger/);
      expect(MAILER_FILE).toBe("packages/auth/src/mailer.ts");
    });

    test("is not applied twice: a file that already imports emailMailer is refused", () => {
      expect(() => wireEmailIntoAuth(wireEmailIntoAuth(before, "@app"), "@app")).toThrow(
        /unconfiguredMailer\(apiLogger\)/,
      );
    });
  });

  describe("RESOLUTIONS (each names the file its edit lands in, whose region `bg record` leaves)", () => {
    test("the wiring of email into auth edits auth's mailer.ts", () => {
      expect(RESOLUTIONS["email/resend/wire-email-into-auth"]).toMatchObject({
        module: "email/resend",
        editedOwner: "auth/better-auth",
        file: MAILER_FILE,
      });
    });
  });

  describe("the intent[<id>] region `bg record` leaves on a file an intention edited (060, 065)", () => {
    const ID = "email/resend/wire-email-into-auth";
    const manifest = (regions: unknown) => ({ regions });

    test("is spelled `intent[<id>]`", () => {
      expect(intentRegion(ID)).toBe("intent[email/resend/wire-email-into-auth]");
    });

    test("expectIntentRegion passes when bg.json records it on the file, owned by the module that ships the intention", () => {
      expect(() =>
        expectIntentRegion(
          manifest({ [MAILER_FILE]: { [intentRegion(ID)]: "email/resend" } }),
          ID,
          MAILER_FILE,
          "email/resend",
        ),
      ).not.toThrow();
    });

    test("expectIntentRegion fails when it is missing, on another file, or owned by another module", () => {
      expect(() => expectIntentRegion(manifest({}), ID, MAILER_FILE, "email/resend")).toThrow(
        /records no intent\[email\/resend\/wire-email-into-auth\] on packages\/auth\/src\/mailer\.ts/,
      );
      expect(() =>
        expectIntentRegion(
          manifest({ "other.ts": { [intentRegion(ID)]: "email/resend" } }),
          ID,
          MAILER_FILE,
          "email/resend",
        ),
      ).toThrow(/records no intent/);
      expect(() =>
        expectIntentRegion(
          manifest({ [MAILER_FILE]: { [intentRegion(ID)]: "auth/better-auth" } }),
          ID,
          MAILER_FILE,
          "email/resend",
        ),
      ).toThrow(/for auth\/better-auth, and the intention is email\/resend's/);
      expect(() => expectIntentRegion("nope", ID, MAILER_FILE, "email/resend")).toThrow(/regions/);
    });

    test("expectNoIntentRegion passes before the record and fails on a region left by an add", () => {
      expect(() =>
        expectNoIntentRegion(
          manifest({ [MAILER_FILE]: { "imports[@app/email]": "email/resend" } }),
          ID,
        ),
      ).not.toThrow();
      expect(() =>
        expectNoIntentRegion(
          manifest({ [MAILER_FILE]: { [intentRegion(ID)]: "email/resend" } }),
          ID,
        ),
      ).toThrow(
        /already records intent\[email\/resend\/wire-email-into-auth\] on packages\/auth\/src\/mailer\.ts/,
      );
    });

    test("readKept reads the files `bg add` kept as the project has them, and expectKept names the one missing", () => {
      const out = JSON.stringify({ kept: [MAILER_FILE] });

      expect(readKept(out)).toEqual([MAILER_FILE]);
      expect(() => expectKept(out, MAILER_FILE)).not.toThrow();
      expect(() => expectKept(JSON.stringify({ kept: [] }), MAILER_FILE)).toThrow(
        /did not keep packages\/auth\/src\/mailer\.ts/,
      );
      expect(() => readKept("nope")).toThrow(/did not print JSON/);
      expect(() => readKept("{}")).toThrow(/no `kept` list/);
    });
  });

  describe("wiredTest (the proof that auth delivers through the email module)", () => {
    test("signs a user up through the mailer auth exports, and reads the outbox of the email package", () => {
      const proof = wiredTest("@app");

      expect(proof).toContain('import { mailer } from "./mailer";');
      expect(proof).toContain('from "@app/email/testing"');
      expect(proof).toContain("createTestAuth({ mailer })");
      expect(proof).toContain("Verify your email address");
      expect(proof).toContain("Reset your password");
      expect(proof).not.toContain("{{SCOPE}}");
    });
  });
});

describe("the storage phases", () => {
  test("a configuration counts the storage tests and expects its table when it installs the storage module, and only the cloudflare one does", () => {
    expect(hasStorage({ name: "a", modules: ["api/elysia", "storage/r2"], items: false })).toBe(
      true,
    );
    expect(
      hasStorage({ name: "b", modules: ["api/elysia", "auth/better-auth"], items: false }),
    ).toBe(false);
    expect(CONFIGURATIONS.filter(hasStorage).map(({ name }) => name)).toEqual(["cloudflare"]);
  });

  test("storage is installed after the db, the orm and the auth it peers on", () => {
    const modules = CONFIGURATIONS.find(({ name }) => name === "cloudflare")?.modules ?? [];

    for (const peer of ["db/d1", "orm/drizzle", "auth/better-auth"]) {
      expect(modules.indexOf("storage/r2")).toBeGreaterThan(modules.indexOf(peer));
    }
  });

  test("the migration has to create the table golden adds and the medias table", () => {
    expect(MODULE_TABLES).toEqual({ "storage/r2": ["medias"] });
    expect(expectedTables({ name: "a", modules: ["orm/drizzle"], items: false })).toEqual([
      GOLDEN_TABLE,
    ]);
    const cloudflare = CONFIGURATIONS.find(({ name }) => name === "cloudflare");
    expect(cloudflare === undefined ? [] : expectedTables(cloudflare)).toEqual([
      GOLDEN_TABLE,
      "medias",
    ]);
  });

  test("the floor is the storage package's own count: the legacy media tests and what the extraction added", () => {
    expect(STORAGE_MIN_TESTS).toBeGreaterThanOrEqual(44);
    expect(() =>
      expectRan({ "@app/storage": STORAGE_MIN_TESTS }, "@app/storage", STORAGE_MIN_TESTS),
    ).not.toThrow();
    expect(() =>
      expectRan({ "@app/storage": STORAGE_MIN_TESTS - 1 }, "@app/storage", STORAGE_MIN_TESTS),
    ).toThrow(new RegExp(`ran ${STORAGE_MIN_TESTS - 1} tests`));
  });
});
