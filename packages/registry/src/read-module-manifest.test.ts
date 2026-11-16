import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readInstalledModuleManifest } from "./read-module-manifest";

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

const AUTH = {
  id: "better-auth",
  category: "auth",
  title: "Better Auth",
  description: "Session auth.",
  peers: { db: ["d1"] },
  variants: [{ key: "default", match: {} }],
};

async function registryWith(file: string, body: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "bg-modreg-"));
  dirs.push(root);
  await mkdir(join(root, "registry/modules/auth/better-auth"), { recursive: true });
  await writeFile(join(root, "registry", file), body);
  return root;
}

describe("readInstalledModuleManifest", () => {
  test("reads modules/<category>/<id>/module.json from a local registry", async () => {
    const root = await registryWith("modules/auth/better-auth/module.json", JSON.stringify(AUTH));
    const found = await readInstalledModuleManifest(
      `local:${join(root, "registry")}`,
      "/nowhere",
      "auth",
      "better-auth",
    );
    expect(found).toMatchObject({ found: true, manifest: { id: "better-auth" } });
    expect(found.found && found.manifest.peers).toEqual({ db: ["d1"] });
  });

  test("resolves a relative local source against the project root", async () => {
    const root = await registryWith("modules/auth/better-auth/module.json", JSON.stringify(AUTH));
    const found = await readInstalledModuleManifest(
      "local:./registry",
      root,
      "auth",
      "better-auth",
    );
    expect(found.found).toBe(true);
  });

  test("does not reach for the network: a github source is not found, with the reason", async () => {
    const found = await readInstalledModuleManifest(
      "github:Netoun/bonne-garde-toolkit@v0.1.0",
      "/nowhere",
      "auth",
      "better-auth",
    );
    expect(found).toMatchObject({ found: false });
    expect(!found.found && found.reason).toMatch(/not local/);
  });

  test("a source it cannot parse is not found, not a throw", async () => {
    const found = await readInstalledModuleManifest("nonsense", "/nowhere", "auth", "better-auth");
    expect(found.found).toBe(false);
    expect(!found.found && found.reason).toContain("unsupported registry source");
  });

  test("a registry without that module.json is not found, naming the path", async () => {
    const root = await registryWith("modules/auth/better-auth/README.md", "# hi\n");
    const found = await readInstalledModuleManifest(
      `local:${join(root, "registry")}`,
      "/nowhere",
      "auth",
      "better-auth",
    );
    expect(found.found).toBe(false);
    expect(!found.found && found.reason).toContain("modules/auth/better-auth/module.json");
  });

  test("an invalid module.json is not found, with the parser's message", async () => {
    const root = await registryWith(
      "modules/auth/better-auth/module.json",
      JSON.stringify({ ...AUTH, category: "nope" }),
    );
    const found = await readInstalledModuleManifest(
      `local:${join(root, "registry")}`,
      "/nowhere",
      "auth",
      "better-auth",
    );
    expect(found.found).toBe(false);
    expect(!found.found && found.reason).toMatch(/category/);
  });
});
