import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serveGithubRaw, type GithubRawServer } from "../test-support/github-raw-server";
import { loadLocalRegistry, loadRegistryFromSource, parseRegistrySource } from "./load-registry";

describe("parseRegistrySource", () => {
  test("parses local and github sources", () => {
    expect(parseRegistrySource("local:./registry")).toEqual({
      kind: "local",
      value: "./registry",
    });
    expect(parseRegistrySource("github:acme/bg@v1.0.0")).toEqual({
      kind: "github",
      value: "acme/bg",
      ref: "v1.0.0",
    });
  });

  test("keeps a branch name with slashes whole as the ref", () => {
    const expected = {
      kind: "github",
      value: "acme/bg",
      ref: "feat/platform-cli-registry",
    } as const;
    expect(parseRegistrySource("github:acme/bg@feat/platform-cli-registry")).toEqual(expected);
    expect(parseRegistrySource("acme/bg@feat/platform-cli-registry")).toEqual(expected);
  });

  test("leaves the ref out when there is none", () => {
    expect(parseRegistrySource("github:acme/bg")).toEqual({
      kind: "github",
      value: "acme/bg",
      ref: undefined,
    });
  });

  test("reads a path that starts with a dot or a slash as local, not as owner/repo", () => {
    for (const path of ["./registry", "../registry", "/abs/registry", ".hidden/registry"]) {
      expect(parseRegistrySource(path)).toEqual({ kind: "local", value: path });
    }
  });

  test("refuses a github source that is not owner/repo", () => {
    for (const source of ["github:acme", "github:", "github:acme/bg/extra", "github:acme/bg@"]) {
      expect(() => parseRegistrySource(source)).toThrow(/invalid github registry source/);
    }
  });
});

describe("loadLocalRegistry", () => {
  const dirs: string[] = [];

  afterAll(async () => {
    await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  test("resolves include and absolutizes file paths", async () => {
    const root = await mkdtemp(join(tmpdir(), "bg-reg-"));
    dirs.push(root);
    await mkdir(join(root, "ui"), { recursive: true });
    await writeFile(
      join(root, "registry.json"),
      JSON.stringify({
        name: "bg",
        include: ["ui/registry.json"],
      }),
    );
    await writeFile(join(root, "ui", "button.tsx"), "export const Button = () => null;\n");
    await writeFile(
      join(root, "ui", "registry.json"),
      JSON.stringify({
        items: [
          {
            name: "button",
            type: "registry:ui",
            files: [{ path: "button.tsx", type: "registry:ui" }],
          },
        ],
      }),
    );

    const catalog = await loadLocalRegistry(join(root, "registry.json"));
    expect(catalog.items).toHaveLength(1);
    expect(catalog.items[0]?.files?.[0]?.path).toBe(join(root, "ui", "button.tsx"));
  });
});

describe("loadRegistryFromSource over github", () => {
  const registryDir = join(import.meta.dir, "../../../registry");
  const servers: GithubRawServer[] = [];
  const temp: string[] = [];

  afterEach(async () => {
    for (const server of servers.splice(0)) {
      server.stop();
    }
    await Promise.all(temp.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
  });

  function serve(ref: string, dir = registryDir): GithubRawServer {
    const server = serveGithubRaw({ registryDir: dir, ownerRepo: "acme/bg", ref });
    servers.push(server);
    return server;
  }

  test("follows `include`, so the items are those of a local read of the same tree", async () => {
    const raw = serve("feat/platform-cli-registry");
    const remote = await loadRegistryFromSource("github:acme/bg@feat/platform-cli-registry", "/", {
      github: { baseUrl: raw.baseUrl },
    });
    const local = await loadLocalRegistry(join(registryDir, "registry.json"));

    expect(remote.name).toBe(local.name);
    expect(remote.items.length).toBeGreaterThan(5);
    const relative = (path: string, root: string) => path.slice(root.length + 1);
    expect(
      remote.items.map((item) => ({
        ...item,
        files: item.files?.map((file) => ({ ...file, path: relative(file.path, "registry") })),
      })),
    ).toEqual(
      local.items.map((item) => ({
        ...item,
        files: item.files?.map((file) => ({ ...file, path: relative(file.path, local.rootDir) })),
      })),
    );
  });

  test("reads the root and each included file once", async () => {
    const raw = serve("v1");
    await loadRegistryFromSource("github:acme/bg@v1", "/", { github: { baseUrl: raw.baseUrl } });
    expect(raw.requested.sort()).toEqual([
      "features/registry.json",
      "registry.json",
      "tooling/registry.json",
      "ui/registry.json",
    ]);
  });

  test("an unknown ref says which ref, and has no stack trace in its message", async () => {
    const raw = serve("v1");
    const failure = await loadRegistryFromSource("github:acme/bg@v9.9.9", "/", {
      github: { baseUrl: raw.baseUrl },
    }).catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(Error);
    const message = (failure as Error).message;
    expect(message).toContain("github:acme/bg@v9.9.9");
    expect(message).toContain("registry/registry.json");
    expect(message).not.toContain("\n    at ");
  });

  test("an unknown ref read with a token says the token may be what GitHub refused", async () => {
    const raw = serve("v1");
    const failure = await loadRegistryFromSource("github:acme/bg@v9.9.9", "/", {
      github: { baseUrl: raw.baseUrl, token: "stale" },
    }).catch((error: unknown) => error);
    expect((failure as Error).message).toContain("GITHUB_TOKEN");
  });

  test("a source with no ref reads the platform tag", async () => {
    const raw = serve("v0.4.2");
    const catalog = await loadRegistryFromSource("github:acme/bg", "/", {
      platformVersion: "0.4.2",
      github: { baseUrl: raw.baseUrl },
    });
    expect(catalog.items.length).toBeGreaterThan(0);
    expect(raw.requested).not.toContain("/acme/bg/HEAD/registry/registry.json");
  });

  test("a source with no ref and no platform version asks for a pinned ref", async () => {
    await expect(loadRegistryFromSource("github:acme/bg", "/")).rejects.toThrow(/pin a ref/);
  });

  test("refuses an item whose file would land outside the project", async () => {
    for (const bad of [
      { target: "../evil.txt" },
      { target: "/etc/evil" },
      { path: "../../x.txt" },
    ]) {
      const root = await mkdtemp(join(tmpdir(), "bg-hostile-"));
      temp.push(root);
      await writeFile(
        join(root, "registry.json"),
        JSON.stringify({
          name: "hostile",
          items: [
            {
              name: "evil",
              type: "registry:file",
              files: [{ path: "evil.txt", type: "registry:file", ...bad }],
            },
          ],
        }),
      );
      const raw = serve("v1", root);
      await expect(
        loadRegistryFromSource("github:acme/bg@v1", "/", { github: { baseUrl: raw.baseUrl } }),
      ).rejects.toThrow(/outside/);
    }
  });
});
