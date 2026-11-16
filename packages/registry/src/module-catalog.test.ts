import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadModuleCatalog } from "./module-catalog";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

async function registryRoot(files: Record<string, unknown>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bg-modcat-"));
  dirs.push(root);
  for (const [path, body] of Object.entries(files)) {
    await mkdir(dirname(join(root, path)), { recursive: true });
    await writeFile(join(root, path), typeof body === "string" ? body : JSON.stringify(body));
  }
  return root;
}

const manifest = (category: string, id: string) => ({
  id,
  category,
  title: id,
  description: id,
  variants: [{ key: "default", match: {} }],
});

describe("loadModuleCatalog", () => {
  test("reads every modules/<category>/<id>/module.json, in path order", async () => {
    const root = await registryRoot({
      "modules/provider/dockerfile/module.json": manifest("provider", "dockerfile"),
      "modules/provider/cloudflare/module.json": manifest("provider", "cloudflare"),
      "modules/auth/better-auth/module.json": manifest("auth", "better-auth"),
    });

    const modules = await loadModuleCatalog(root);

    expect(modules.map(({ manifest: m }) => `${m.category}/${m.id}`)).toEqual([
      "auth/better-auth",
      "provider/cloudflare",
      "provider/dockerfile",
    ]);
    expect(modules[0]?.dir).toBe(join(root, "modules/auth/better-auth"));
  });

  test("a registry with no modules directory has no modules", async () => {
    expect(await loadModuleCatalog(await registryRoot({ "registry.json": {} }))).toEqual([]);
  });

  test("a directory without a module.json is not a module", async () => {
    const root = await registryRoot({ "modules/provider/draft/README.md": "# draft\n" });

    expect(await loadModuleCatalog(root)).toEqual([]);
  });

  test("a module.json that disagrees with its path is refused, naming the file", async () => {
    const root = await registryRoot({
      "modules/provider/cloudflare/module.json": manifest("provider", "dockerfile"),
    });

    await expect(loadModuleCatalog(root)).rejects.toThrow(
      /modules\/provider\/cloudflare\/module\.json declares provider\/dockerfile: its path says provider\/cloudflare/,
    );
  });

  test("a module.json that does not parse is refused, naming the file", async () => {
    const root = await registryRoot({
      "modules/provider/cloudflare/module.json": {
        ...manifest("provider", "cloudflare"),
        variants: [],
      },
    });

    await expect(loadModuleCatalog(root)).rejects.toThrow(
      /modules\/provider\/cloudflare\/module\.json: variants must be a non-empty array/,
    );
  });
});
