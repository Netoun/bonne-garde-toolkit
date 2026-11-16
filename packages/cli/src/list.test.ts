import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalRegistry, type RegistryModule } from "@bonne-garde/registry";
import { serveGithubRaw, type GithubRawServer } from "@bonne-garde/registry/testing";
import { MODULE_CATEGORIES } from "@bonne-garde/schema";
import { listRegistry } from "./list";
import { findRepoRoot } from "./paths";

const REGISTRY_DIR = join(findRepoRoot() ?? "", "registry");
const LOCAL = `local:${REGISTRY_DIR}`;

const dirs: string[] = [];
const servers: GithubRawServer[] = [];

afterEach(async () => {
  for (const server of servers.splice(0)) {
    server.stop();
  }
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** The real `bg` entry, run in a directory that is not a project, as `bg list --source` allows. */
async function runBg(...args: string[]) {
  const cwd = await mkdtemp(join(tmpdir(), "bg-list-"));
  dirs.push(cwd);
  const proc = Bun.spawn(["bun", join(REGISTRY_DIR, "../packages/cli/src/bin.ts"), ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

const registry = () => loadLocalRegistry(join(REGISTRY_DIR, "registry.json"));

/** What `bg list` printed before it knew modules: `name<TAB>type<TAB>description`, registry order. */
async function itemLines(): Promise<string[]> {
  return (await registry()).items.map(
    (item) => `${item.name}\t${item.type}\t${item.description ?? ""}`,
  );
}

/** Spec 035 order: the category table's, then the id. */
function inCategoryOrder(modules: RegistryModule[]): RegistryModule[] {
  return MODULE_CATEGORIES.flatMap((category) =>
    modules
      .filter(({ manifest }) => manifest.category === category)
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
  );
}

const moduleLine = ({ manifest }: RegistryModule) =>
  `${manifest.category}/${manifest.id}\tmodule\t${manifest.description}`;

describe("bg list", () => {
  test("--items prints the items exactly as bg list did before modules", async () => {
    const { stdout, stderr, code } = await runBg("list", "--items", "--source", LOCAL);

    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout).toBe(`${(await itemLines()).join("\n")}\n`);
    expect(stdout.split("\n")[0]).toMatch(/^utils\tregistry:lib\t/);
  });

  test("prints the items, then the modules as <category>/<id> in category order", async () => {
    const { stdout, stderr, code } = await runBg("list", "--source", LOCAL);

    const modules = inCategoryOrder((await registry()).modules);
    expect(code).toBe(0);
    expect(stderr).toBe("");
    expect(stdout.trimEnd().split("\n")).toEqual([
      ...(await itemLines()),
      ...modules.map(moduleLine),
    ]);
    expect(modules.map(({ manifest }) => manifest.category)).toContain("tooling");
    expect(stdout).toContain("tooling/vite-plus\tmodule\t");
  });

  test("--category prints the modules of that category and no item", async () => {
    const { stdout, code } = await runBg("list", "--category", "provider", "--source", LOCAL);

    const providers = inCategoryOrder((await registry()).modules).filter(
      ({ manifest }) => manifest.category === "provider",
    );
    expect(code).toBe(0);
    expect(providers.length).toBeGreaterThan(1);
    expect(stdout).toBe(`${providers.map(moduleLine).join("\n")}\n`);
  });

  test("--category with no module in it prints nothing and exits 0", async () => {
    const { stdout, code } = await runBg("list", "--category", "payments", "--source", LOCAL);

    expect(code).toBe(0);
    expect(stdout).toBe("");
  });

  test("an unknown category fails and names the ones that exist", async () => {
    const { stdout, stderr, code } = await runBg("list", "--category", "tools", "--source", LOCAL);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("unknown category: tools");
    for (const category of MODULE_CATEGORIES) {
      expect(stderr).toContain(category);
    }
  });

  test("--items with --category fails: an item has no category", async () => {
    const { stdout, stderr, code } = await runBg(
      "list",
      "--items",
      "--category",
      "tooling",
      "--source",
      LOCAL,
    );

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("--items");
    expect(stderr).toContain("--category");
  });

  test("an argument it does not know fails, so a typo cannot list everything", async () => {
    const { stdout, stderr, code } = await runBg("list", "--itmes", "--source", LOCAL);

    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("--itmes");
  });

  test("--category without a value fails", async () => {
    const { stderr, code } = await runBg("list", "--source", LOCAL, "--category");

    expect(code).toBe(1);
    expect(stderr).toContain("missing value for --category");
  });
});

describe("bg list from a github source", () => {
  function serve(): GithubRawServer {
    const server = serveGithubRaw({
      registryDir: REGISTRY_DIR,
      ownerRepo: "acme/bg",
      ref: "main",
    });
    servers.push(server);
    return server;
  }

  const query = { itemsOnly: false, category: undefined, source: "github:acme/bg@main" };

  test("lists the items and says the modules cannot be listed, rather than printing none", async () => {
    const raw = serve();

    const { lines, notes } = await listRegistry(process.cwd(), query, { baseUrl: raw.baseUrl });

    expect(lines).toEqual(await itemLines());
    expect(notes).toHaveLength(1);
    expect(notes[0]).toContain("github:acme/bg@main");
    expect(notes[0]).toContain("modules");
    expect(notes[0]).toContain("bg add <category>/<id>");
  });

  test("--items says nothing about modules, since it did not ask for any", async () => {
    const raw = serve();

    const { lines, notes } = await listRegistry(
      process.cwd(),
      { ...query, itemsOnly: true },
      { baseUrl: raw.baseUrl },
    );

    expect(lines).toEqual(await itemLines());
    expect(notes).toEqual([]);
  });
});
