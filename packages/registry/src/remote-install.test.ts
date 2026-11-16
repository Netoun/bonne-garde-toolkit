import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createEmptyProjectManifest } from "@bonne-garde/schema";
import { serveGithubRaw, type GithubRawServer } from "../test-support/github-raw-server";
import { RegistrySourceError } from "./github-source";
import { loadRegistryFromSource } from "./load-registry";
import { classifyNames, resolveModulePlans } from "./module-plan";
import { loadNamedModules, readPlanFiles } from "./remote-install";
import { resolveInstallPlan } from "./resolve-plan";

const REPO_REGISTRY = join(import.meta.dir, "../../../registry");
const PROJECT = createEmptyProjectManifest({
  scope: "@demo",
  registries: {},
  platformVersion: "0.1.0",
});

const servers: GithubRawServer[] = [];
const temp: string[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  await Promise.all(temp.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

function serve(dir = REPO_REGISTRY): GithubRawServer {
  const server = serveGithubRaw({ registryDir: dir, ownerRepo: "acme/bg", ref: "v1" });
  servers.push(server);
  return server;
}

async function remote(raw: GithubRawServer) {
  return loadRegistryFromSource("github:acme/bg@v1", "/", { github: { baseUrl: raw.baseUrl } });
}

/** A registry on disk: `files` maps a registry-relative path to its text, or to its bytes. */
async function registryOf(files: Record<string, string | Uint8Array>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bg-remote-"));
  temp.push(root);
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), text);
  }
  return root;
}

const moduleJson = (id: string, category: string, copy: string[]) =>
  JSON.stringify({
    id,
    category,
    version: "0.1.0",
    title: id,
    description: id,
    peers: {},
    variants: [{ key: "default", match: {}, copy }],
  });

describe("loadNamedModules", () => {
  test("hands back a local catalog untouched, with no request", async () => {
    const catalog = { name: "x", items: [], modules: [], rootDir: "/r" };
    expect(await loadNamedModules(catalog, ["provider/cloudflare"])).toBe(catalog);
  });

  test("fetches only the module.json a qualified name points at", async () => {
    const raw = serve();
    const catalog = await remote(raw);
    raw.requested.length = 0;

    const loaded = await loadNamedModules(catalog, ["provider/cloudflare"]);

    expect(raw.requested).toEqual(["modules/provider/cloudflare/module.json"]);
    expect(loaded.modules.map(({ manifest }) => `${manifest.category}/${manifest.id}`)).toEqual([
      "provider/cloudflare",
    ]);
    expect(loaded.modules[0]?.dir).toBe("registry/modules/provider/cloudflare");
    expect(loaded.modules[0]?.reader).toBe(catalog.reader);
  });

  test("looks a bare name up in every category, and keeps the one that exists", async () => {
    const raw = serve();
    const catalog = await remote(raw);
    raw.requested.length = 0;

    const loaded = await loadNamedModules(catalog, ["cloudflare"]);

    expect(raw.requested.length).toBeGreaterThan(10);
    expect(
      raw.requested.every((path) => /^modules\/[a-z]+\/cloudflare\/module\.json$/.test(path)),
    ).toBe(true);
    expect(loaded.modules.map(({ manifest }) => manifest.category)).toEqual(["provider"]);
  });

  test("a name that is no module leaves the catalog's modules empty, and is not an error", async () => {
    const raw = serve();
    const loaded = await loadNamedModules(await remote(raw), [
      "button",
      "provider/nope",
      "Not A Name",
    ]);
    expect(loaded.modules).toEqual([]);
  });

  test("a bare name that is an item and a module is refused, as it is from a local registry", async () => {
    const dir = await registryOf({
      "registry.json": JSON.stringify({
        name: "dup",
        items: [{ name: "dup", type: "registry:file", files: [] }],
      }),
      "modules/provider/dup/module.json": moduleJson("dup", "provider", []),
    });
    const catalog = await loadNamedModules(await remote(serve(dir)), ["dup"]);
    expect(() => classifyNames(catalog, ["dup"])).toThrow(/both an item and a module/);
  });

  test("refuses a module.json whose path says another category or id", async () => {
    const dir = await registryOf({
      "registry.json": JSON.stringify({ name: "r", items: [] }),
      "modules/provider/liar/module.json": moduleJson("truth", "provider", []),
    });
    await expect(loadNamedModules(await remote(serve(dir)), ["provider/liar"])).rejects.toThrow(
      /its path says provider\/liar/,
    );
  });

  test("an unknown qualified name is reported as missing from the registry, not as an empty category", async () => {
    const raw = serve();
    const catalog = await loadNamedModules(await remote(raw), ["provider/nope"]);
    expect(() => classifyNames(catalog, ["provider/nope"])).toThrow(
      /modules\/provider\/nope\/module\.json.*github:acme\/bg@v1/,
    );
  });
});

describe("readPlanFiles", () => {
  test("is the plan itself for a local catalog", async () => {
    const catalog = { name: "x", items: [], modules: [], rootDir: "/r" };
    const plan = resolveInstallPlan(catalog, [], PROJECT);
    expect(await readPlanFiles(catalog, plan)).toBe(plan);
  });

  test("fetches the files of the planned items, and no others", async () => {
    const raw = serve();
    const catalog = await remote(raw);
    const plan = resolveInstallPlan(catalog, ["button"], PROJECT, [
      { category: "ui", id: "shadcn" },
    ]);
    raw.requested.length = 0;

    const read = await readPlanFiles(catalog, plan);

    expect(read.items.map((item) => item.name)).toEqual(["utils", "animations", "button"]);
    const button = read.items.find((item) => item.name === "button")?.files?.[0];
    expect(button?.content).toContain("function Button(");
    expect(raw.requested.sort()).toEqual(
      read.items
        .flatMap((item) => item.files ?? [])
        .map((file) => file.path.slice("registry/".length))
        .sort(),
    );
    expect(raw.requested).not.toContain("ui/card.tsx");
  });

  test("a file that is not valid UTF-8 fails the whole read, naming the item: items are text-only (030)", async () => {
    const dir = await registryOf({
      "registry.json": JSON.stringify({ name: "r", include: ["items/registry.json"] }),
      "items/registry.json": JSON.stringify({
        items: [
          {
            name: "icon",
            type: "registry:file",
            files: [{ path: "icon.png", type: "registry:file", target: "src/icon.png" }],
          },
        ],
      }),
      "items/icon.png": Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0xff, 0x00]),
    });
    const catalog = await remote(serve(dir));
    const plan = resolveInstallPlan(catalog, ["icon"], PROJECT);

    await expect(readPlanFiles(catalog, plan)).rejects.toThrow(
      /item icon .*registry\/items\/icon\.png.*not valid UTF-8.*items are text-only/s,
    );
  });

  test("a file the registry does not have fails the whole read, naming it and the ref", async () => {
    const raw = serve();
    const catalog = await remote(raw);
    const plan = resolveInstallPlan(catalog, ["button"], PROJECT, [
      { category: "ui", id: "shadcn" },
    ]);
    raw.missing.add("ui/button.tsx");

    const failure = await readPlanFiles(catalog, plan).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RegistrySourceError);
    expect((failure as Error).message).toContain("registry/ui/button.tsx");
    expect((failure as Error).message).toContain("github:acme/bg@v1");
  });
});

describe("a module planned from github", () => {
  test("a file that is not text is planned as the same bytes as from a local registry", async () => {
    // A PNG signature, the placeholder as ASCII, and a byte that UTF-8 text cannot hold.
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, ...Buffer.from("{{SCOPE}}"), 0xff, 0x00]);
    const dir = await registryOf({
      "registry.json": JSON.stringify({ name: "r", items: [] }),
      "modules/config/icons/module.json": moduleJson("icons", "config", ["packages/icons/a.png"]),
      "modules/config/icons/template/packages/icons/a.png": png,
    });
    const refs = [{ category: "config" as const, id: "icons" }];
    const catalog = await loadNamedModules(await remote(serve(dir)), ["config/icons"]);

    const [plan] = await resolveModulePlans(catalog, refs, PROJECT);

    const local = await loadRegistryFromSource(`local:${dir}`, "/");
    const [expected] = await resolveModulePlans(local, refs, PROJECT);
    expect(plan).toEqual(expected);
    expect(Buffer.from(plan?.binaries[0]?.bytes ?? []).equals(png)).toBe(true);
  });

  test("plans the same files as from a local registry, fetching only the variant's copy", async () => {
    const raw = serve();
    const catalog = await loadNamedModules(await remote(raw), ["provider/cloudflare"]);
    raw.requested.length = 0;

    const [plan] = await resolveModulePlans(
      catalog,
      [{ category: "provider", id: "cloudflare" }],
      PROJECT,
    );

    const local = await loadRegistryFromSource(`local:${REPO_REGISTRY}`, "/");
    const [expected] = await resolveModulePlans(
      local,
      [{ category: "provider", id: "cloudflare" }],
      PROJECT,
    );
    expect(plan).toEqual(expected);
    const template = "modules/provider/cloudflare/template/packages/api-runtime";
    expect([...raw.requested].sort()).toEqual([
      `${template}/package.json`,
      `${template}/src/index.test.ts`,
      `${template}/src/index.ts`,
      `${template}/tsconfig.json`,
      `${template}/tsconfig.test.json`,
    ]);
  });

  test("a template file the registry does not have fails the plan, naming the module and the file", async () => {
    const raw = serve();
    const catalog = await loadNamedModules(await remote(raw), ["provider/cloudflare"]);
    raw.missing.add("modules/provider/cloudflare/template/packages/api-runtime/src/index.ts");

    await expect(
      resolveModulePlans(catalog, [{ category: "provider", id: "cloudflare" }], PROJECT),
    ).rejects.toThrow(
      /provider\/cloudflare.*packages\/api-runtime\/src\/index\.ts.*github:acme\/bg@v1/,
    );
  });

  test("a glob in `copy` is refused: raw has no directory listing to expand it against", async () => {
    const dir = await registryOf({
      "registry.json": JSON.stringify({ name: "r", items: [] }),
      "modules/provider/globby/module.json": moduleJson("globby", "provider", ["packages/x/**"]),
      "modules/provider/globby/template/packages/x/a.ts": "a\n",
    });
    const catalog = await loadNamedModules(await remote(serve(dir)), ["provider/globby"]);
    await expect(
      resolveModulePlans(catalog, [{ category: "provider", id: "globby" }], PROJECT),
    ).rejects.toThrow(/packages\/x\/\*\*.*glob.*github:acme\/bg@v1/);
  });

  describe("the intentions a module authors, read from intent/ like a template file", () => {
    const DOCUMENT =
      "---\nid: provider/wired/wire-it\nkind: install\ndomain: provider\nclassification: migration\n---\n\n# Wire it into {{SCOPE}}\n";
    const wired = (files: Record<string, string> = {}) =>
      registryOf({
        "registry.json": JSON.stringify({ name: "r", items: [] }),
        "modules/provider/wired/module.json": JSON.stringify({
          id: "wired",
          category: "provider",
          title: "wired",
          description: "wired",
          peers: {},
          variants: [{ key: "default", match: {}, intent: ["01-wire-it.md"] }],
        }),
        ...files,
      });

    test("is fetched by its path under the module and planned with the scope rendered", async () => {
      const raw = serve(await wired({ "modules/provider/wired/intent/01-wire-it.md": DOCUMENT }));
      const catalog = await loadNamedModules(await remote(raw), ["provider/wired"]);
      raw.requested.length = 0;

      const [plan] = await resolveModulePlans(
        catalog,
        [{ category: "provider", id: "wired" }],
        PROJECT,
      );

      expect(raw.requested).toEqual(["modules/provider/wired/intent/01-wire-it.md"]);
      expect(plan?.intentions).toEqual([
        {
          id: "provider/wired/wire-it",
          module: "provider/wired",
          title: "Wire it into @demo",
          document: DOCUMENT.replaceAll("{{SCOPE}}", "@demo"),
        },
      ]);
    });

    test("a file the registry does not have fails the plan, naming the module and the file", async () => {
      const raw = serve(await wired());
      const catalog = await loadNamedModules(await remote(raw), ["provider/wired"]);

      await expect(
        resolveModulePlans(catalog, [{ category: "provider", id: "wired" }], PROJECT),
      ).rejects.toThrow(
        /provider\/wired names the intention 01-wire-it\.md, which its intent\/ does not hold/,
      );
    });
  });

  test("a `copy` that climbs out of the project is refused when the module is read", async () => {
    const dir = await registryOf({
      "registry.json": JSON.stringify({ name: "r", items: [] }),
      "modules/provider/escape/module.json": moduleJson("escape", "provider", ["../../../x"]),
    });
    await expect(loadNamedModules(await remote(serve(dir)), ["provider/escape"])).rejects.toThrow(
      /without '\.\.'/,
    );
  });
});
