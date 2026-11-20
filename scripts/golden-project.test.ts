import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadLocalRegistry, patchRegions, plannedPatches } from "../packages/registry/src/index";
import { cliRunner } from "../packages/schema/src/cli-runner";
import { sha256Hex } from "../packages/registry/src/index";
import {
  addArguments,
  assetPath,
  BINARY_FAVICONS,
  expectBuildHoldsFavicons,
  expectFaviconsIdentical,
  expectFaviconsServed,
  expectManifestEmitted,
  expectOwnPublicKept,
  faviconHrefs,
  FAVICONS_DIR,
  faviconShells,
  hasFavicons,
  manifestHref,
  manifestIconPaths,
  AUTH_TABLES,
  buildsImage,
  ANSWER_SETS,
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
  AUTH_LIBSQL_MIN_TESTS,
  AUTH_MIN_TESTS,
  authMinTests,
  cookieHeader,
  expectServedBack,
  GOLDEN_PNG,
  hasMediaOnDisk,
  MEDIA_DIR,
  mediaPath,
  readUploadedMedia,
  STORAGE_FS_MIN_TESTS,
  storageMinTests,
  VERIFY_EMAIL_SCRIPT,
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
  readReselected,
  RESELECTED,
  RESELECT_BASE,
  expectReselected,
  RESOLUTIONS,
  wiredTest,
  wireEmailIntoAuth,
  hasStorage,
  intentRegion,
  WITHOUT_ORM,
  MODULE_TABLES,
  MODULES,
  PATCHED,
  packageManagerOf,
  runnerOf,
  publishedPort,
  ranTests,
  hasFeatures,
  hasSqliteFile,
  hasPostgres,
  providerOf,
  readPostgresService,
  postgresUrl,
  expectPostgresMigrated,
  goldenSchema,
  GOLDEN_PG_SCHEMA,
  GOLDEN_SCHEMA,
  readAddedItems,
  readAddedModules,
  readKept,
  snapshot,
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
  SQLITE_FILE,
  SPA_SHELL_MIN_TESTS,
  STORAGE_MIN_TESTS,
  testCounts,
  until,
  DEPLOY_BUILD_NEEDS,
  DEPLOY_MODULE,
  DEPLOY_PLAN,
  expectBuildNeeds,
  expectBuildVarsRefusal,
  expectDeployableApp,
  expectDeployPlan,
  expectEveryAppPlanned,
  expectProviderRefusal,
  expectWorkflow,
  hasDeploy,
  readDeployNeeds,
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

  test("fails when the listing is empty, so a broken `bonne-garde list` is not a green run", () => {
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

  test("the dockerfile configuration has the db feature, and its database is libsql", () => {
    expect(ANSWER_SETS.dockerfile?.features).toContain("db");
    const dockerfile = CONFIGURATIONS.find(({ name }) => name === "dockerfile");
    expect(dockerfile?.modules).toContain("db/libsql");
    expect(dockerfile?.modules).toContain("orm/drizzle");
    expect(dockerfile?.modules).not.toContain("db/d1");
  });

  test("the dockerfile configuration has auth and storage, which create maps by provider: auth over libsql, files on disk", () => {
    expect(ANSWER_SETS.dockerfile?.features).toEqual(
      expect.arrayContaining(["db", "auth", "storage"]),
    );
    const dockerfile = CONFIGURATIONS.find(({ name }) => name === "dockerfile");
    expect(dockerfile?.modules).toContain("auth/better-auth");
    expect(dockerfile?.modules).toContain("storage/fs");
    expect(dockerfile?.modules).not.toContain("storage/r2");
    expect(Object.keys(EXCLUDED_MODULES)).not.toContain("storage/fs");
  });

  test("the dockerfile-postgres configuration is create without the db feature, then add db/postgres orm/drizzle", () => {
    expect(ANSWER_SETS["dockerfile-postgres"]?.features).not.toContain("db");
    const postgres = CONFIGURATIONS.find(({ name }) => name === "dockerfile-postgres");
    expect(postgres?.modules).toContain("db/postgres");
    expect(postgres?.modules).toContain("orm/drizzle");
    expect(postgres?.modules).not.toContain("db/libsql");
    expect(postgres?.modules).not.toContain("db/d1");
    expect(postgres?.modules.slice(-2)).toEqual(["db/postgres", "orm/drizzle"]);
    // What `create` maps for the dockerfile answers minus the db feature, in the dockerfile one's order.
    const dockerfile = CONFIGURATIONS.find(({ name }) => name === "dockerfile");
    expect(postgres?.modules.slice(0, -2)).toEqual(
      (dockerfile?.modules ?? []).filter(
        (name) => !["db/libsql", "orm/drizzle", "auth/better-auth", "storage/fs"].includes(name),
      ),
    );
  });

  test("a configuration has features when it installs the items and has the auth module they need", () => {
    const [cloudflare, dockerfile, fronts] = CONFIGURATIONS;
    expect(hasFeatures(cloudflare as Configuration)).toBe(true);
    expect(hasFeatures(dockerfile as Configuration)).toBe(true);
    expect(hasFeatures(fronts as Configuration)).toBe(false);
  });

  test("the spa runs the shell's tests everywhere, and the features' too where they are installed", () => {
    const [cloudflare, dockerfile] = CONFIGURATIONS;
    expect(spaMinTests(dockerfile as Configuration)).toBe(
      SPA_SHELL_MIN_TESTS + SPA_FEATURE_MIN_TESTS,
    );
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

  test("takes the module lines of `bonne-garde list` and skips the items", () => {
    expect(selectModules(FULL_LISTING, ["tooling/vite-plus"], exclusions)).toEqual({
      modules: ["tooling/vite-plus"],
      excluded: [
        { name: "provider/cloudflare", reason: "one provider per project" },
        { name: "provider/dockerfile", reason: "one provider per project" },
      ],
    });
  });

  test("installs the modules in the order it was given, not the order `bonne-garde list` printed", () => {
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

  test("fails on an installed module that `bonne-garde list` does not show", () => {
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

  test("fails when nothing is installed, so a broken `bonne-garde list` is not a green run", () => {
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

  test("fails when `bonne-garde add` did not report a module golden asked for", () => {
    expect(() => readAddedModules(output, ["tooling/vite-plus", "db/d1"])).toThrow(/db\/d1/);
  });

  test("fails on output that is not the JSON `bonne-garde add` prints", () => {
    expect(() => readAddedModules("not json", [])).toThrow(/bonne-garde add/);
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

    const { modules, excluded } = selectModules(listing, MODULES, EXCLUDED_MODULES);

    expect(excluded).toEqual([]);
    expect(modules).toEqual([
      "pm/pnpm",
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
      "pm/bun",
      "provider/dockerfile",
      "db/libsql",
      "storage/fs",
      "db/postgres",
    ]);
  });

  test("each package manager drives at least one configuration, the one with the most modules on pnpm", () => {
    const managers = CONFIGURATIONS.map((configuration) => packageManagerOf(configuration));

    expect([...new Set(managers)].sort()).toEqual(["bun", "pnpm"]);
    expect(packageManagerOf(CONFIGURATIONS[0] ?? { name: "none", modules: [], items: false })).toBe(
      "pnpm",
    );
    expect(runnerOf("pnpm").run("db:seed")).toEqual(["pnpm", "run", "db:seed"]);
    expect(runnerOf("pnpm").exec("wrangler", "d1")).toEqual(["pnpm", "exec", "wrangler", "d1"]);
    expect(runnerOf("bun").exec("tsx", "x.ts")).toEqual(["bun", "x", "tsx", "x.ts"]);
    expect(() => runnerOf("yarn")).toThrow(/yarn/);
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
    // `create` maps the db and storage features by provider, so the dockerfile configuration installs
    // `db/libsql` and `storage/fs`: every module of the registry is in a configuration.
    expect(EXCLUDED_MODULES).toEqual({});
  });

  test("only the configuration with a ui module installs items, which land in packages/ui", () => {
    for (const { modules, items } of CONFIGURATIONS) {
      if (items) {
        expect(modules).toContain("ui/shadcn");
      }
    }
    // The dockerfile configuration installs the items its spa and auth bring: the image the Dockerfile has to build.
    expect(CONFIGURATIONS.find(({ name }) => name === "dockerfile")?.items).toBe(true);
  });

  test("no item golden installs shares its bare name with a module: `bonne-garde add` refuses a name that is both", async () => {
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
  test("is one `bonne-garde add`: the modules, then every item, with --yes and --no-install", () => {
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

  test("fails with no module, so an empty `bonne-garde list` is not a green run", () => {
    expect(() => addArguments([], ["button"])).toThrow(/no modules/);
  });

  test("takes no items, for a configuration that installs modules only; selectItems refuses an empty `bonne-garde list`", () => {
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
  // What the packed CLI prints is prefixed by the runner of the package manager that ran golden.
  const ADD = `${cliRunner()} add`;
  const stderr = `button needs the ui module, and none is installed or named in this call; run: ${ADD} ui/shadcn button\n`;

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
    ).toThrow(/bonne-garde add ui\/shadcn button.*unknown name: button/s);
  });

  test("a feature item in a bare project is refused for every module it needs, named in one command (030)", () => {
    const all = `spa-auth needs the ui, auth and web/spa modules, and none is installed or named in this call; run: ${ADD} ui/shadcn auth/better-auth web/spa spa-auth\n`;

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
      /bonne-garde add ui\/shadcn spa-auth/,
    );
  });

  test("a project missing one module is refused for that one alone", () => {
    const storage = `spa-backoffice needs the storage module, and none is installed or named in this call; run: ${ADD} storage/r2 spa-backoffice\n`;

    expect(() =>
      expectRefusal({ code: 1, stderr: storage }, "spa-backoffice", "storage/r2"),
    ).not.toThrow();
    expect(() =>
      expectRefusal({ code: 1, stderr: storage }, "spa-backoffice", "auth/better-auth"),
    ).toThrow(/bonne-garde add auth\/better-auth spa-backoffice/);
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

  test("fails on a patch that is not what `bonne-garde add` prints", () => {
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
      // What `bonne-garde add` does: among the variants whose `match` the configuration satisfies, the most specific.
      const regions: Record<string, string[]> = {};
      for (const { manifest } of catalog.modules) {
        // The package manager's module is `create --pm`'s, not golden's `bg add`'s.
        if (
          !modules.includes(`${manifest.category}/${manifest.id}`) ||
          manifest.category === "pm"
        ) {
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
        // by the `intent[<id>]` region `bonne-garde record` leaves, not by a patch that imports for it.
        "email/resend": ["dependencies.@app/email"],
        "deploy/cloudflare-actions": ["devDependencies.jsonc-parser", "scripts.deploy:cloudflare"],
      },
      dockerfile: {
        "config/branding": ["scripts.gen:branding"],
        "api/elysia": ["scripts.dev"],
        "orm/drizzle": [
          "dependencies.@app/db",
          "dependencies.drizzle-orm",
          "dependencies.elysia",
          "devDependencies.drizzle-kit",
          "elysia[app].use[dbModule]",
          'exports."."',
          'exports."./schema"',
          'exports."./testing"',
          "imports[@app/db]",
          "scripts.db:generate",
        ],
        "auth/better-auth": [
          "dependencies.@app/auth",
          "dependencies.@app/auth",
          "elysia[app].use[authModule]",
          'exports."."',
          'exports."./client"',
          'exports."./schema"',
          'exports."./testing"',
          "exports[@app/auth/schema]",
          "imports[@app/auth]",
          "scripts.auth:generate",
          "scripts.auth:secret",
          "scripts.db:seed",
          "scripts.test",
          "scripts.typecheck",
        ],
        "storage/fs": [
          "dependencies.@app/storage",
          "dependencies.@app/storage",
          "elysia[app].use[mediaModule]",
          "exports[@app/storage/schema]",
          "imports[@app/storage]",
        ],
        "email/resend": ["dependencies.@app/email"],
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
        "deploy/cloudflare-actions": ["devDependencies.jsonc-parser", "scripts.deploy:cloudflare"],
      },
      "dockerfile-postgres": {
        "config/branding": ["scripts.gen:branding"],
        "api/elysia": ["scripts.dev"],
        "orm/drizzle": [
          "dependencies.@app/db",
          "dependencies.drizzle-orm",
          "dependencies.elysia",
          "devDependencies.drizzle-kit",
          "elysia[app].use[dbModule]",
          'exports."."',
          'exports."./schema"',
          'exports."./testing"',
          "imports[@app/db]",
          "scripts.db:generate",
        ],
        "web/spa": ["scripts.dev"],
        "dev/portless": [
          "devDependencies.portless",
          "scripts.dev:lan:portless",
          "scripts.dev:portless",
        ],
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

describe("expectRegionsRecorded (bg.json carries what `bonne-garde add` reported)", () => {
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

describe("hasSqliteFile (the container's volume holds the database file once the first request has been served)", () => {
  test("is the dockerfile configuration and no other", () => {
    expect(CONFIGURATIONS.filter(hasSqliteFile).map(({ name }) => name)).toEqual(["dockerfile"]);
    expect(SQLITE_FILE).toBe("/data/db.sqlite");
  });
});

describe("providerOf (the launcher plans what the provider runs, not what the configuration is called)", () => {
  test("is the id of the configuration's provider module", () => {
    expect(Object.fromEntries(CONFIGURATIONS.map((c) => [c.name, providerOf(c)]))).toEqual({
      cloudflare: "cloudflare",
      dockerfile: "dockerfile",
      fronts: "cloudflare",
      "dockerfile-postgres": "dockerfile",
    });
  });
});

describe("hasPostgres (golden starts a Postgres beside the container and reads it back)", () => {
  test("is the dockerfile-postgres configuration and no other", () => {
    expect(CONFIGURATIONS.filter(hasPostgres).map(({ name }) => name)).toEqual([
      "dockerfile-postgres",
    ]);
  });

  test("has a database to generate for, which the D1 phases do not cover", () => {
    const postgres = CONFIGURATIONS.find(hasPostgres);
    expect(postgres === undefined ? true : hasDatabase(postgres)).toBe(false);
    expect(postgres === undefined ? [] : expectedTables(postgres)).toEqual([GOLDEN_TABLE]);
  });
});

describe("the Postgres of the compose file", () => {
  const compose = `# comment
services:
  postgres:
    image: postgres:17-alpine
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: secret
      POSTGRES_DB: app
    ports:
      - "127.0.0.1:5432:5432"
`;

  test("readPostgresService reads the image and the credentials the file names", () => {
    expect(readPostgresService(compose)).toEqual({
      image: "postgres:17-alpine",
      user: "postgres",
      password: "secret",
      database: "app",
    });
  });

  test("readPostgresService fails on a file with no postgres service or a missing credential", () => {
    expect(() => readPostgresService("services:\n  app:\n    image: x\n")).toThrow(/postgres/);
    expect(() => readPostgresService("services:\n  postgres:\n    image: postgres:17\n")).toThrow(
      /POSTGRES_USER/,
    );
    expect(() => readPostgresService("nope")).toThrow(/postgres/);
  });

  test("postgresUrl points at a host on the docker network, on the port Postgres listens on", () => {
    const service = readPostgresService(compose);
    expect(postgresUrl(service, "bg-golden-1-postgres")).toBe(
      "postgres://postgres:secret@bg-golden-1-postgres:5432/app",
    );
  });
});

describe("goldenSchema (the table golden adds is written in the dialect of the configuration's ORM)", () => {
  test("is a pgTable for Postgres and the SQLite one otherwise", () => {
    const [cloudflare] = CONFIGURATIONS;
    const postgres = CONFIGURATIONS.find(hasPostgres);
    expect(goldenSchema(cloudflare as Configuration)).toBe(GOLDEN_SCHEMA);
    expect(goldenSchema(postgres as Configuration)).toBe(GOLDEN_PG_SCHEMA);
    expect(GOLDEN_PG_SCHEMA).toContain('from "drizzle-orm/pg-core"');
    expect(GOLDEN_PG_SCHEMA).toContain(`pgTable("${GOLDEN_TABLE}"`);
    expect(GOLDEN_PG_SCHEMA).toContain("export const goldenNotes");
  });
});

describe("expectPostgresMigrated (what psql finds in the Postgres the container migrated)", () => {
  test("passes on the table and one recorded migration", () => {
    expect(() =>
      expectPostgresMigrated({ table: "1\n", migrations: "1\n" }, "golden_notes"),
    ).not.toThrow();
  });

  test("fails naming the table when it is missing", () => {
    expect(() =>
      expectPostgresMigrated({ table: "0\n", migrations: "1\n" }, "golden_notes"),
    ).toThrow(/golden_notes/);
  });

  test("fails when the migration was not recorded once", () => {
    expect(() =>
      expectPostgresMigrated({ table: "1\n", migrations: "0\n" }, "golden_notes"),
    ).toThrow(/__drizzle_migrations/);
    expect(() =>
      expectPostgresMigrated({ table: "1\n", migrations: "2\n" }, "golden_notes"),
    ).toThrow(/__drizzle_migrations/);
    expect(() => expectPostgresMigrated({ table: "", migrations: "" }, "golden_notes")).toThrow();
  });
});

describe("buildsImage (golden builds the image of the configuration that ships a Dockerfile)", () => {
  test("is the dockerfile configuration and no other", () => {
    expect(
      CONFIGURATIONS.filter((configuration) => buildsImage(configuration)).map(({ name }) => name),
    ).toEqual(["dockerfile", "dockerfile-postgres"]);
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
    expect(CONFIGURATIONS.filter(refusesDeploy).map(({ name }) => name)).toEqual([
      "dockerfile",
      "dockerfile-postgres",
    ]);
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
      "build apps/api: vp run build",
      "build apps/spa: vp run build",
      "build apps/ssr: vp run build",
      "build apps/static: vp run build",
      "migrate apps/api: vp run db:migrate:remote --env production",
      "deploy apps/api: vp run deploy --env production",
      "deploy apps/spa: vp run deploy --project-name my-app-spa --branch main",
      "deploy apps/ssr: vp run deploy --env production",
      "deploy apps/static: vp run deploy --project-name my-app-static --branch main",
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

  describe("readDeployPlan (what `vp run deploy:cloudflare --dry-run` prints)", () => {
    const printed = JSON.stringify({
      environment: "production",
      buildVars: ["VITE_API_URL"],
      steps: [
        { phase: "build", app: "api", cwd: "apps/api", argv: ["vp", "run", "build"] },
        {
          phase: "deploy",
          app: "api",
          cwd: "apps/api",
          argv: ["vp", "run", "deploy", "--env", "production"],
        },
        { phase: "build", app: "spa", cwd: "apps/spa", argv: ["vp", "run", "build"] },
      ],
    });

    test("reads each step as `<phase> <cwd>: <command>`, the apps once each in order, and the variable names", () => {
      expect(readDeployPlan(printed)).toEqual({
        steps: [
          "build apps/api: vp run build",
          "deploy apps/api: vp run deploy --env production",
          "build apps/spa: vp run build",
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

  describe("the variables a build needs", () => {
    const needs = { "apps/spa": ["VITE_API_URL"], "apps/static": ["VITE_API_URL"] };

    test("golden expects the SPA and the static site to need the API URL, and no other app a variable", () => {
      expect(DEPLOY_BUILD_NEEDS.cloudflare).toEqual(needs);
    });

    test("reads them from the plan the dry run printed, by app", () => {
      expect(
        readDeployNeeds(JSON.stringify({ steps: [], buildVars: [], requiredBuildVars: needs })),
      ).toEqual(needs);
      expect(readDeployNeeds(JSON.stringify({ requiredBuildVars: {} }))).toEqual({});
    });

    test("fails on a plan that does not say, and on output that is not a plan", () => {
      expect(() => readDeployNeeds(JSON.stringify({ steps: [] }))).toThrow(/requiredBuildVars/);
      expect(() =>
        readDeployNeeds(JSON.stringify({ requiredBuildVars: { "apps/spa": 1 } })),
      ).toThrow(/requiredBuildVars/);
      expect(() => readDeployNeeds("deploy: nothing to deploy")).toThrow(/not JSON/);
    });

    test("passes the plan whose needs are the expected ones, whatever the order of the apps", () => {
      expect(() => expectBuildNeeds(needs, { ...needs })).not.toThrow();
      expect(() =>
        expectBuildNeeds({ "apps/static": ["VITE_API_URL"], "apps/spa": ["VITE_API_URL"] }, needs),
      ).not.toThrow();
    });

    test("names the app that needs more, less or another variable than golden expects", () => {
      expect(() => expectBuildNeeds({ "apps/spa": ["VITE_API_URL"] }, needs)).toThrow(
        /apps\/static.*\(nothing\).*VITE_API_URL/s,
      );
      expect(() => expectBuildNeeds({ ...needs, "apps/ssr": ["VITE_API_URL"] }, needs)).toThrow(
        /apps\/ssr needs VITE_API_URL.*expects \(nothing\)/s,
      );
      expect(() => expectBuildNeeds({ ...needs, "apps/spa": ["VITE_OTHER"] }, needs)).toThrow(
        /apps\/spa needs VITE_OTHER.*expects VITE_API_URL/s,
      );
    });

    describe("expectBuildVarsRefusal", () => {
      const refusal = {
        code: 1,
        output:
          "deploy: a build is missing a variable it needs: apps/spa needs VITE_API_URL; apps/static needs VITE_API_URL",
      };

      test("passes a refusal that names every app and variable and prints no value", () => {
        expect(() =>
          expectBuildVarsRefusal(refusal, needs, ["https://golden.invalid"]),
        ).not.toThrow();
      });

      test("fails a dry run that passed", () => {
        expect(() => expectBuildVarsRefusal({ code: 0, output: "{}" }, needs, [])).toThrow(
          /must be refused/,
        );
      });

      test("fails a refusal that does not name an app or a variable", () => {
        expect(() =>
          expectBuildVarsRefusal({ code: 1, output: "apps/spa needs VITE_API_URL" }, needs, []),
        ).toThrow(/apps\/static/);
        expect(() =>
          expectBuildVarsRefusal({ code: 1, output: "deploy: failed" }, needs, []),
        ).toThrow(/apps\/spa.*failed/s);
      });

      test("fails a refusal that printed a value it was handed", () => {
        expect(() =>
          expectBuildVarsRefusal(
            { ...refusal, output: `${refusal.output} (https://golden.invalid)` },
            needs,
            ["https://golden.invalid"],
          ),
        ).toThrow(/value/);
      });
    });
  });

  describe("expectDeployPlan", () => {
    const expected = [
      "build apps/api: vp run build",
      "deploy apps/api: vp run deploy --env production",
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
        expectDeployPlan([...expected, "deploy apps/x: vp run deploy"], expected),
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
    const setup = (path: string) => path === "./.github/actions/setup";

    test("passes the workflow the module ships, in a project with the scripts and the setup it runs", async () => {
      const workflow = await real();

      expect(() => expectWorkflow(workflow, scripts, setup)).not.toThrow();
    });

    test("fails a script the project does not have, naming it", async () => {
      const workflow = await real();

      expect(() =>
        expectWorkflow(workflow, ["check", "typecheck", "deploy:cloudflare"], setup),
      ).toThrow(/vp run test/);
    });

    test("fails a local action the project does not ship, which its pm module does", async () => {
      const workflow = await real();

      expect(() => expectWorkflow(workflow, scripts, () => false)).toThrow(
        /\.\/\.github\/actions\/setup/,
      );
    });

    test("fails a workflow that is not YAML, one that runs on push, and one with no deploy job", async () => {
      const workflow = await real();

      expect(() => expectWorkflow("jobs: [", scripts, setup)).toThrow(/YAML/);
      expect(() =>
        expectWorkflow(workflow.replace("on: workflow_dispatch", "on: push"), scripts, setup),
      ).toThrow(/workflow_dispatch/);
      expect(() =>
        expectWorkflow(
          "on: workflow_dispatch\njobs:\n  validate:\n    steps: []\n",
          scripts,
          setup,
        ),
      ).toThrow(/deploy/);
    });

    test("fails a deploy job that does not run the script the project has for it", async () => {
      const workflow = await real();

      expect(() =>
        expectWorkflow(
          workflow.replace("run: vp run deploy:cloudflare\n", "run: wrangler deploy\n"),
          scripts,
          setup,
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
    "react-router",
    "dev",
  ];

  /** The JSON `tsx scripts/dev-portless.ts --dry-run` prints, for the apps of the cloudflare configuration. */
  const printed = (tld: string, overrides: Record<string, Record<string, unknown>> = {}) => {
    const apiUrl = `https://api.${SLUG}.${tld}`;
    return JSON.stringify({
      slug: SLUG,
      lan: tld === "local",
      apps: expectedPortlessApps("cloudflare", SLUG, tld).map((app) => ({
        ...app,
        url: `https://${app.name}.${tld}`,
        cwd: `apps/${app.dir}`,
        // A Worker is told through `--var`, every other app through its environment: the Worker a
        // Vite command runs also asked to read it.
        env:
          app.dir === "api"
            ? {}
            : { API_URL: apiUrl, VITE_API_URL: apiUrl, CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" },
        ...overrides[app.dir],
      })),
    });
  };

  test("the launcher is a feature a project opts into: cloudflare and dockerfile do, fronts proves a project without it, and it has tests to count", () => {
    expect(CONFIGURATIONS.filter(hasPortless).map(({ name }) => name)).toEqual([
      "cloudflare",
      "dockerfile",
      "dockerfile-postgres",
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
      'exec wrangler dev --port "$PORT" "$@"',
      "wrangler",
      "--var",
      `API_URL:https://api.${SLUG}.localhost`,
      "--var",
      `SPA_URL:https://spa.${SLUG}.localhost`,
      "--var",
      `SSR_URL:https://ssr.${SLUG}.localhost`,
      "--var",
      `STATIC_URL:https://static.${SLUG}.localhost`,
    ]);
    expect(apps.slice(1).map(({ cmd }) => cmd)).toEqual(["spa", "ssr", "static"].map(frontCommand));
  });

  test("a project on the dockerfile provider plans two apps, the API as a tsx process that reads PORT", () => {
    expect(expectedPortlessApps("dockerfile", "golden-dockerfile", "localhost")).toEqual([
      {
        dir: "api",
        name: "api.golden-dockerfile",
        cmd: ["portless", "run", "--name", "api.golden-dockerfile", "tsx", "watch", "src/index.ts"],
      },
      {
        dir: "spa",
        name: "spa.golden-dockerfile",
        cmd: ["portless", "run", "--name", "spa.golden-dockerfile", "react-router", "dev"],
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

    test("expects the Worker a Vite command runs, and no other app, to be told to read the process environment", () => {
      expect(expected.filter((app) => app.includesProcessEnv).map(({ dir }) => dir)).toEqual([
        "spa",
        "ssr",
        "static",
      ]);
      expect(
        expectedPortlessApps("dockerfile", "golden-dockerfile", "localhost"),
      ).not.toContainEqual(expect.objectContaining({ includesProcessEnv: true }));
    });

    test("names the front that was not told to, whose Worker would keep the API_URL of its config", () => {
      const apiUrl = `https://api.${SLUG}.localhost`;
      const unaware = printed("localhost", {
        ssr: { env: { API_URL: apiUrl, VITE_API_URL: apiUrl } },
      });

      expect(() => expectPortlessPlan(unaware, expected, "localhost")).toThrow(
        /ssr.*CLOUDFLARE_INCLUDE_PROCESS_ENV.*not set/s,
      );
    });

    test("names an app that was told to when golden did not expect it", () => {
      const told = printed("localhost", {
        api: { env: { CLOUDFLARE_INCLUDE_PROCESS_ENV: "true" } },
      });

      expect(() => expectPortlessPlan(told, expected, "localhost")).toThrow(
        /api.*CLOUDFLARE_INCLUDE_PROCESS_ENV.*set, expected it not set/s,
      );
    });
  });

  describe("ranTests", () => {
    test("reads the count from the summary Vitest prints", () => {
      expect(ranTests("\n Test Files  1 passed (1)\n      Tests  33 passed (33)\n")).toBe(33);
      expect(ranTests("      Tests  1 passed (1)")).toBe(1);
    });

    test("reads it through the colors Vitest prints when CI forces them", () => {
      expect(
        ranTests(
          "\u001b[2m      Tests \u001b[22m \u001b[1m\u001b[32m36 passed\u001b[39m\u001b[22m (36)\n",
        ),
      ).toBe(36);
    });

    test("fails when there is no such line, so a run that printed nothing is not a pass", () => {
      expect(() => ranTests("")).toThrow(/Tests/);
    });
  });
});

describe("the database phases", () => {
  test("a configuration has a D1 to generate and migrate when it installs the orm module over db/d1", () => {
    const d1 = ["api/elysia", "db/d1", "orm/drizzle"];
    expect(hasDatabase({ name: "a", modules: d1, items: false })).toBe(true);
    expect(hasDatabase({ name: "b", modules: ["api/elysia", "db/d1"], items: false })).toBe(false);
    expect(
      hasDatabase({
        name: "c",
        modules: ["api/elysia", "db/libsql", "orm/drizzle"],
        items: false,
      }),
    ).toBe(false);
  });

  test("only the cloudflare configuration has a D1 to migrate: the dockerfile one has libsql, which the phases do not drive", () => {
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

    test("accepts the double-quoted table of a Postgres migration", () => {
      const pg = 'CREATE TABLE "golden_notes" (\n\t"id" serial PRIMARY KEY NOT NULL\n);\n';
      expect(expectGenerated(["0000_x.sql", "meta"], pg, "golden_notes")).toBe("0000_x.sql");
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
  test("reads how many tests each workspace ran from the labeled output of the root test script", () => {
    const output = [
      "[@app/config#test]  Test Files  1 passed (1)",
      "[@app/config#test]       Tests  6 passed (6)",
      "[@app/db#test]       Tests  12 passed (12)",
      "[@app/ssr#test]       Tests  4 passed (4)",
      "      Tests  9 passed (9)",
    ].join("\n");

    expect(testCounts(output)).toEqual({ "@app/config": 6, "@app/db": 12, "@app/ssr": 4 });
  });

  test("reads Vitest's line when it is coloured, as it is in CI", () => {
    // The line as GitHub Actions printed it: Vitest colours its output when CI is set.
    const output =
      "[@app/spa#test] \u001B[2m      Tests \u001B[22m \u001B[1m\u001B[32m8 passed\u001B[39m\u001B[22m\u001B[90m (8)\u001B[39m";

    expect(testCounts(output)).toEqual({ "@app/spa": 8 });
  });
});

describe("the auth phases", () => {
  test("a configuration generates the auth schema again when it installs the auth module, and the cloudflare and dockerfile ones do", () => {
    expect(hasAuth({ name: "a", modules: ["api/elysia", "auth/better-auth"], items: false })).toBe(
      true,
    );
    expect(hasAuth({ name: "b", modules: ["api/elysia", "orm/drizzle"], items: false })).toBe(
      false,
    );
    expect(CONFIGURATIONS.filter(hasAuth).map(({ name }) => name)).toEqual([
      "cloudflare",
      "dockerfile",
    ]);
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
  test("every configuration installs email, and the ones with auth have the wiring pending", () => {
    expect(CONFIGURATIONS.filter(hasEmail).map(({ name }) => name)).toEqual([
      "cloudflare",
      "dockerfile",
      "dockerfile-postgres",
    ]);
    expect(hasEmail({ name: "a", modules: ["api/elysia"], items: false })).toBe(false);
    // The Postgres project has no auth: email installs there on its own, and cleanly.
    expect(
      CONFIGURATIONS.find(({ name }) => name === "dockerfile-postgres")?.modules,
    ).not.toContain("auth/better-auth");
    expect(CONFIGURATIONS.find(({ name }) => name === "dockerfile")?.modules).toContain(
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

  describe("PENDING (050 step 14: what `bonne-garde add` leaves for an executor, per configuration)", () => {
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
        dockerfile: ["email/resend/wire-email-into-auth"],
        "dockerfile-postgres": [],
        fronts: [],
      });
      expect(Object.keys(RESOLUTIONS)).toEqual(["email/resend/wire-email-into-auth"]);
    });
  });

  describe("readPendingIntentions", () => {
    const out = (pendingIntentions: unknown) => JSON.stringify({ modules: [], pendingIntentions });

    test("reads the ids `bonne-garde add` printed, in order, and none when there are none", () => {
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

  describe("readReselected", () => {
    const out = (reselected: unknown) => JSON.stringify({ modules: [], reselected });

    test("reads the modules `bonne-garde add` planned again, with the variant each left and took, and none when there are none", () => {
      expect(
        readReselected(
          out([
            {
              module: "email/resend",
              from: "default",
              to: "better-auth",
              because: ["auth/better-auth"],
            },
          ]),
        ),
      ).toEqual([{ module: "email/resend", from: "default", to: "better-auth" }]);
      expect(readReselected(out([]))).toEqual([]);
    });

    test("fails on output that is not JSON, or has no list, or an entry without a module and its variants", () => {
      expect(() => readReselected("nope")).toThrow(/did not print JSON/);
      expect(() => readReselected("{}")).toThrow(/no `reselected` array/);
      expect(() => readReselected(out([{ module: "email/resend" }]))).toThrow(
        /without module, from and to/,
      );
    });
  });

  describe("expectReselected", () => {
    const email = { module: "email/resend", from: "default", to: "better-auth" };

    test("passes on the modules expected, and on none expected and none reported", () => {
      expect(() => expectReselected([email], [email])).not.toThrow();
      expect(() => expectReselected([], [])).not.toThrow();
    });

    test("fails on a module planned again that was not expected, one that was not planned again, and a variant that differs", () => {
      expect(() => expectReselected([email], [])).toThrow(
        /planned again \[email\/resend default -> better-auth\], golden expects \[\]/,
      );
      expect(() => expectReselected([], [email])).toThrow(
        /golden expects \[email\/resend default -> better-auth\]/,
      );
      expect(() => expectReselected([{ ...email, to: "default" }], [email])).toThrow(
        /planned again/,
      );
    });
  });

  test("the project that installs email first and auth second is the one golden checks the other order with", () => {
    expect(RESELECT_BASE).toContain("email/resend");
    expect(RESELECT_BASE).not.toContain("auth/better-auth");
    expect(RESELECT_BASE).toEqual(expect.arrayContaining(WITHOUT_ORM));
    expect(RESELECTED).toEqual({ module: "email/resend", from: "default", to: "better-auth" });
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

  describe("RESOLUTIONS (each names the file its edit lands in, whose region `bonne-garde record` leaves)", () => {
    test("the wiring of email into auth edits auth's mailer.ts", () => {
      expect(RESOLUTIONS["email/resend/wire-email-into-auth"]).toMatchObject({
        module: "email/resend",
        editedOwner: "auth/better-auth",
        file: MAILER_FILE,
      });
    });
  });

  describe("the intent[<id>] region `bonne-garde record` leaves on a file an intention edited (060, 065)", () => {
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

    test("readKept reads the files `bonne-garde add` kept as the project has them, and expectKept names the one missing", () => {
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
  test("a configuration counts the storage tests when it installs a storage module, and the cloudflare and dockerfile ones do", () => {
    expect(hasStorage({ name: "a", modules: ["api/elysia", "storage/r2"], items: false })).toBe(
      true,
    );
    expect(
      hasStorage({ name: "b", modules: ["api/elysia", "auth/better-auth"], items: false }),
    ).toBe(false);
    expect(CONFIGURATIONS.filter(hasStorage).map(({ name }) => name)).toEqual([
      "cloudflare",
      "dockerfile",
    ]);
    expect(hasStorage({ name: "c", modules: ["api/elysia", "storage/fs"], items: false })).toBe(
      true,
    );
  });

  test("storage is installed after the db, the orm and the auth it peers on", () => {
    const modules = CONFIGURATIONS.find(({ name }) => name === "cloudflare")?.modules ?? [];

    for (const peer of ["db/d1", "orm/drizzle", "auth/better-auth"]) {
      expect(modules.indexOf("storage/r2")).toBeGreaterThan(modules.indexOf(peer));
    }
  });

  test("the migration has to create the table golden adds and the medias table", () => {
    expect(MODULE_TABLES).toEqual({ "storage/r2": ["medias"], "storage/fs": ["medias"] });
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

describe("the favicons config/branding ships, binary template files", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function put(root: string, path: string, content: string | Uint8Array): Promise<void> {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }

  // A PNG signature, and the byte 0xff, which UTF-8 text cannot hold. Its lookalike differs by that
  // byte alone: both read as the same text, and only the bytes tell them apart.
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
  const LOOKALIKE = Uint8Array.from(PNG, (byte) => (byte === 0xff ? 0xfe : byte));
  const SOURCE = "modules/config/branding/template";

  /** A registry and a project that hold the seven favicons, the project's `bg.json` recording their sha256. */
  async function pair(): Promise<{ registry: string; project: string }> {
    const root = await mkdtemp(join(tmpdir(), "bg-golden-favicons-"));
    dirs.push(root);
    const registry = join(root, "registry");
    const project = join(root, "project");
    const files: Record<string, { owner: string; sha256: string }> = {};
    for (const name of BINARY_FAVICONS) {
      await put(registry, `${SOURCE}/${FAVICONS_DIR}/${name}`, PNG);
      await put(project, `${FAVICONS_DIR}/${name}`, PNG);
      files[`${FAVICONS_DIR}/${name}`] = { owner: "config/branding", sha256: sha256Hex(PNG) };
    }
    await put(project, "bg.json", JSON.stringify({ files }));
    return { registry, project };
  }

  test("there are seven, each a binary the registry holds, and every configuration with the module and the spa is asked for them", () => {
    expect(BINARY_FAVICONS).toHaveLength(7);
    expect(new Set(BINARY_FAVICONS).size).toBe(7);
    for (const configuration of CONFIGURATIONS) {
      expect(hasFavicons(configuration)).toBe(
        configuration.modules.includes("config/branding") &&
          configuration.modules.includes("web/spa"),
      );
    }
    expect(CONFIGURATIONS.filter(hasFavicons).map(({ name }) => name)).toEqual([
      "cloudflare",
      "dockerfile",
      "fronts",
      "dockerfile-postgres",
    ]);
  });

  test("the generated project holds each of them byte for byte as the registry does, and bg.json records that sha256", async () => {
    const { registry, project } = await pair();

    await expect(expectFaviconsIdentical(registry, project)).resolves.toBeUndefined();
  });

  test("a favicon that differs by a byte that decoded text cannot tell apart is named", async () => {
    const { registry, project } = await pair();
    await put(project, `${FAVICONS_DIR}/favicon.ico`, LOOKALIKE);

    await expect(expectFaviconsIdentical(registry, project)).rejects.toThrow(
      /favicon\.ico differs from the registry's/,
    );
  });

  test("a favicon bg.json records another sha256 for, or the project lacks, is named", async () => {
    const { registry, project } = await pair();
    await put(project, "bg.json", JSON.stringify({ files: {} }));
    await expect(expectFaviconsIdentical(registry, project)).rejects.toThrow(
      /bg\.json records no sha256 for .*favicon-16x16\.png/,
    );

    const { registry: other, project: bare } = await pair();
    await rm(join(bare, FAVICONS_DIR, "apple-touch-icon.png"));
    await expect(expectFaviconsIdentical(other, bare)).rejects.toThrow(
      /apple-touch-icon\.png is missing/,
    );
  });

  test("the manifest of a built index.html is a root URL to a file, never a data: URL", () => {
    expect(
      manifestHref(
        '<head><link rel="icon" href="/a.svg"/><link rel="manifest" href="/site.webmanifest"/></head>',
      ),
    ).toBe("/site.webmanifest");
    expect(manifestHref('<link href="/assets/site-abc.webmanifest" rel="manifest">')).toBe(
      "/assets/site-abc.webmanifest",
    );
    expect(() =>
      manifestHref('<link rel="manifest" href="data:application/manifest+json;base64,e30="/>'),
    ).toThrow(/data: URL/);
    expect(() => manifestHref('<link rel="icon" href="/a.svg"/>')).toThrow(/links no manifest/);
  });

  test("each icon of a manifest resolves against the manifest's own URL, as a browser does", () => {
    const manifest = JSON.stringify({
      icons: [{ src: "/android-chrome-192x192.png" }, { src: "icons/a.png" }, { src: "../b.png" }],
    });

    expect(manifestIconPaths(manifest, "/assets/site.webmanifest")).toEqual([
      "/android-chrome-192x192.png",
      "/assets/icons/a.png",
      "/b.png",
    ]);
    expect(() => manifestIconPaths("{}", "/site.webmanifest")).toThrow(/names no icons/);
    expect(() =>
      manifestIconPaths(JSON.stringify({ icons: [{ src: "https://cdn.test/a.png" }] }), "/m"),
    ).toThrow(/not a path of the build/);
  });

  test("the built client holds the manifest the index links and every icon it names, and an icon the build lacks is named", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-golden-built-"));
    dirs.push(root);
    const manifest = JSON.stringify({
      icons: [{ src: "/android-chrome-192x192.png" }, { src: "/android-chrome-512x512.png" }],
    });
    await put(root, "index.html", '<link rel="manifest" href="/site.webmanifest"/>');
    await put(root, "site.webmanifest", manifest);
    await put(root, "android-chrome-192x192.png", PNG);

    await expect(expectManifestEmitted(root)).rejects.toThrow(
      /android-chrome-512x512\.png.*is not in the build/,
    );

    await put(root, "android-chrome-512x512.png", PNG);
    expect(await expectManifestEmitted(root)).toEqual([
      "/android-chrome-192x192.png",
      "/android-chrome-512x512.png",
    ]);

    // Emitted from the project's own favicons: an icon of the build that is not theirs is named.
    await put(root, "android-chrome-512x512.png", LOOKALIKE);
    const source = join(root, "source");
    await put(source, "android-chrome-192x192.png", PNG);
    await put(source, "android-chrome-512x512.png", PNG);
    await expect(expectManifestEmitted(root, source)).rejects.toThrow(
      /android-chrome-512x512\.png of the build differs/,
    );
  });

  test("a snapshot tells two files apart by their bytes, and keeps bg.json as text", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-golden-snapshot-"));
    dirs.push(root);
    await put(root, "icon.png", PNG);
    await put(root, "bg.json", '{"installedAt": "2026-01-01"}');
    const before = await snapshot(root);
    await put(root, "icon.png", LOOKALIKE);

    expect(diffTrees(before, await snapshot(root))).toEqual(["icon.png changed"]);
    expect(before["bg.json"]).toBe('{"installedAt": "2026-01-01"}');
  });
});

describe("every web shell serves the favicons and the manifest config/branding ships", () => {
  const dirs: string[] = [];
  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  async function put(root: string, path: string, content: string | Uint8Array): Promise<void> {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), content);
  }

  // 0xff is a byte UTF-8 text cannot hold, so its lookalike differs by that byte alone.
  const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]);
  const LOOKALIKE = Uint8Array.from(PNG, (byte) => (byte === 0xff ? 0xfe : byte));
  const MANIFEST = JSON.stringify({ icons: [{ src: "/android-chrome-192x192.png" }] });
  const HEAD = [
    '<link rel="preconnect" href="https://fonts.googleapis.com"/>',
    '<link rel="icon" type="image/svg+xml" href="/favicon.svg"/>',
    '<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png"/>',
    '<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png"/>',
    '<link rel="manifest" href="/site.webmanifest"/>',
    '<link rel="stylesheet" href="/assets/root.css"/>',
  ].join("");
  const FILES = {
    "favicon.svg": "<svg/>",
    "favicon-16x16.png": PNG,
    "apple-touch-icon.png": PNG,
    "android-chrome-192x192.png": PNG,
    "site.webmanifest": MANIFEST,
  } as const;

  /** The favicons directory of a project, and the client a shell built from it. */
  async function shell(): Promise<{ root: string; source: string; app: string; client: string }> {
    const root = await mkdtemp(join(tmpdir(), "bg-golden-shell-"));
    dirs.push(root);
    const app = join(root, "apps/ssr");
    for (const [name, content] of Object.entries(FILES)) {
      await put(root, `${FAVICONS_DIR}/${name}`, content);
      await put(app, `build/client/${name}`, content);
    }
    await put(app, "public/robots.txt", "User-agent: *\n");
    await put(app, "build/client/robots.txt", "User-agent: *\n");
    return { root, source: join(root, FAVICONS_DIR), app, client: join(app, "build/client") };
  }

  const configuration = (...modules: string[]): Configuration => ({
    name: "x",
    modules,
    items: false,
  });

  test("a configuration is asked for the shells it installs, when it installs the module that ships the favicons", () => {
    expect(
      faviconShells(configuration("config/branding", "web/spa", "web/ssr", "web/static")),
    ).toEqual(["spa", "ssr", "static"]);
    expect(faviconShells(configuration("config/branding", "web/static", "web/spa"))).toEqual([
      "spa",
      "static",
    ]);
    expect(faviconShells(configuration("config/branding", "web/ssr"))).toEqual(["ssr"]);
    expect(faviconShells(configuration("web/spa", "web/ssr"))).toEqual([]);
    expect(faviconShells(configuration("config/branding"))).toEqual([]);
    expect(
      Object.fromEntries(
        CONFIGURATIONS.map(({ name, ...rest }) => [name, faviconShells({ name, ...rest })]),
      ),
    ).toEqual({
      cloudflare: ["spa", "ssr", "static"],
      dockerfile: ["spa"],
      fronts: ["spa", "ssr", "static"],
      "dockerfile-postgres": ["spa"],
    });
  });

  test("the links of a page that name a favicon or the manifest are its icons, by root URL", () => {
    expect(faviconHrefs(`<head>${HEAD}</head>`)).toEqual([
      "/favicon.svg",
      "/favicon-16x16.png",
      "/apple-touch-icon.png",
      "/site.webmanifest",
    ]);
    expect(() => faviconHrefs('<link rel="icon" href="data:image/svg+xml,%3csvg/%3e"/>')).toThrow(
      /data: URL/,
    );
    expect(() => faviconHrefs('<link rel="icon" href="favicon.svg"/>')).toThrow(/not a root URL/);
    expect(() => faviconHrefs('<link rel="stylesheet" href="/a.css"/>')).toThrow(
      /links no favicon/,
    );
  });

  test("the build holds every file of the favicons directory, byte for byte, and names the ones it lacks or changed", async () => {
    const { source, client } = await shell();

    expect((await expectBuildHoldsFavicons(client, source)).sort()).toEqual(
      Object.keys(FILES).sort(),
    );

    await rm(join(client, "favicon.svg"));
    await put(client, "apple-touch-icon.png", LOOKALIKE);
    await expect(expectBuildHoldsFavicons(client, source)).rejects.toThrow(
      /favicon\.svg is not in the build/,
    );
    await expect(expectBuildHoldsFavicons(client, source)).rejects.toThrow(
      /apple-touch-icon\.png of the build differs/,
    );
  });

  test("the files of the app's own public directory are in its build too, which is why the favicons are not its publicDir", async () => {
    const { app, client } = await shell();

    await expect(expectOwnPublicKept(app)).resolves.toEqual(["robots.txt"]);

    await put(client, "robots.txt", "User-agent: Googlebot\n");
    await expect(expectOwnPublicKept(app)).rejects.toThrow(/robots\.txt of the build differs/);

    await rm(join(client, "robots.txt"));
    await expect(expectOwnPublicKept(app)).rejects.toThrow(/robots\.txt is not in the build/);

    // An app with no public directory has nothing to keep.
    await rm(join(app, "public"), { recursive: true });
    await expect(expectOwnPublicKept(app)).resolves.toEqual([]);
  });

  describe("served by the app itself, over HTTP", () => {
    /** An app of one page: `html` at /, and `files` at their root URL, as a Worker serves its assets. */
    function serving(html: string, files: Record<string, string | Uint8Array>) {
      const server = Bun.serve({
        port: 0,
        hostname: "127.0.0.1",
        fetch(request) {
          const { pathname } = new URL(request.url);
          if (pathname === "/") {
            return new Response(html, { headers: { "content-type": "text/html" } });
          }
          const body = files[pathname.slice(1)];
          if (body === undefined) {
            return new Response("not found", {
              status: 404,
              headers: { "content-type": "text/html" },
            });
          }
          const type = pathname.endsWith(".webmanifest")
            ? "application/manifest+json"
            : "image/png";
          return new Response(body, { headers: { "content-type": type } });
        },
      });
      return { origin: `http://127.0.0.1:${server.port}`, stop: () => server.stop(true) };
    }

    test("the page links the manifest and the icons, and each is served as the file the project holds", async () => {
      const { source } = await shell();
      const app = serving(`<head>${HEAD}</head>`, FILES);
      try {
        expect((await expectFaviconsServed(app.origin, source)).sort()).toEqual([
          "/android-chrome-192x192.png",
          "/apple-touch-icon.png",
          "/favicon-16x16.png",
          "/favicon.svg",
          "/site.webmanifest",
        ]);
      } finally {
        await app.stop();
      }
    });

    test("a page that links its manifest as a data: URL, an icon the app does not serve, and a file that differs are each named", async () => {
      const { source } = await shell();
      const inlined = serving(
        '<link rel="manifest" href="data:application/manifest+json;base64,e30="/>',
        FILES,
      );
      try {
        await expect(expectFaviconsServed(inlined.origin, source)).rejects.toThrow(/data: URL/);
      } finally {
        await inlined.stop();
      }

      const without = Object.fromEntries(
        Object.entries(FILES).filter(([name]) => name !== "android-chrome-192x192.png"),
      );
      const missing = serving(`<head>${HEAD}</head>`, without);
      try {
        await expect(expectFaviconsServed(missing.origin, source)).rejects.toThrow(
          /GET \/android-chrome-192x192\.png: expected 200 image\/png, got 404 text\/html/,
        );
      } finally {
        await missing.stop();
      }

      const changed = serving(`<head>${HEAD}</head>`, { ...FILES, "favicon-16x16.png": LOOKALIKE });
      try {
        await expect(expectFaviconsServed(changed.origin, source)).rejects.toThrow(
          /\/favicon-16x16\.png differs from \S*favicon-16x16\.png/,
        );
      } finally {
        await changed.stop();
      }
    });
  });
});

describe("the media on disk phase (the container's volume holds the uploaded file)", () => {
  test("is the dockerfile configuration, which has an image, auth and storage/fs, and no other", () => {
    expect(CONFIGURATIONS.filter(hasMediaOnDisk).map(({ name }) => name)).toEqual(["dockerfile"]);
    expect(
      hasMediaOnDisk({
        name: "x",
        modules: ["provider/dockerfile", "storage/fs"],
        items: false,
      }),
    ).toBe(false);
    expect(MEDIA_DIR).toBe("/data/media");
    expect(mediaPath("uploads/a-b.png")).toBe("/data/media/uploads/a-b.png");
  });

  test("the libsql variant of auth has its own floor of tests, below d1's", () => {
    const [cloudflare, dockerfile] = CONFIGURATIONS;
    expect(authMinTests(cloudflare as Configuration)).toBe(AUTH_MIN_TESTS);
    expect(authMinTests(dockerfile as Configuration)).toBe(AUTH_LIBSQL_MIN_TESTS);
  });

  test("storage/fs has its own floor of tests, below r2's", () => {
    const [cloudflare, dockerfile] = CONFIGURATIONS;
    expect(storageMinTests(cloudflare as Configuration)).toBe(STORAGE_MIN_TESTS);
    expect(storageMinTests(dockerfile as Configuration)).toBe(STORAGE_FS_MIN_TESTS);
  });

  test("the floor of storage/fs tests is what its template has", async () => {
    const dir = join(resolve(import.meta.dir, ".."), "registry/modules/storage/fs/template");
    let tests = 0;
    for await (const path of new Bun.Glob("packages/storage/src/**/*.test.ts").scan({ cwd: dir })) {
      const text = await Bun.file(join(dir, path)).text();
      tests += [...text.matchAll(/^\s*(?:test|it)(?:\.each\([\s\S]*?\))?\(/gm)].length;
    }
    expect(STORAGE_FS_MIN_TESTS).toBeLessThanOrEqual(tests);
    expect(STORAGE_FS_MIN_TESTS).toBeGreaterThan(tests - 10);
  });

  test("the cookie sent back is the name=value pairs of the sign-in's Set-Cookie headers", () => {
    expect(
      cookieHeader([
        "better-auth.session_token=abc.def; Max-Age=604800; Path=/; HttpOnly; SameSite=Lax",
        "better-auth.session_data=xyz; Path=/",
      ]),
    ).toBe("better-auth.session_token=abc.def; better-auth.session_data=xyz");
    expect(() => cookieHeader([])).toThrow(/no cookie/);
  });

  test("an upload answers a key and a url, and nothing else is one", () => {
    expect(
      readUploadedMedia({
        id: "1",
        key: "uploads/a.png",
        url: "http://x/v1/media/file/uploads/a.png",
      }),
    ).toEqual({ key: "uploads/a.png", url: "http://x/v1/media/file/uploads/a.png" });
    expect(() => readUploadedMedia({ error: "nope" })).toThrow(/not a key and a url/);
    expect(() => readUploadedMedia(null)).toThrow(/not a key and a url/);
  });

  test("the bytes served back are the ones uploaded, as a png", () => {
    expect(() =>
      expectServedBack({ contentType: "image/png", bytes: new Uint8Array(GOLDEN_PNG) }),
    ).not.toThrow();
    expect(() =>
      expectServedBack({ contentType: "text/html", bytes: new Uint8Array(GOLDEN_PNG) }),
    ).toThrow(/not image\/png/);
    expect(() =>
      expectServedBack({ contentType: "image/png", bytes: new Uint8Array([1, 2, 3]) }),
    ).toThrow(/3 bytes/);
    expect(GOLDEN_PNG.slice(0, 4)).toEqual(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]));
  });

  test("the verification script marks one user of the volume's database", () => {
    expect(VERIFY_EMAIL_SCRIPT).toContain("file:/data/db.sqlite");
    expect(VERIFY_EMAIL_SCRIPT).toContain("email_verified = 1");
    expect(VERIFY_EMAIL_SCRIPT).toContain("GOLDEN_EMAIL");
  });
});
