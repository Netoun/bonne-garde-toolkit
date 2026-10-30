import { afterEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { serveGithubRaw, type GithubRawServer } from "../test-support/github-raw-server";
import {
  githubRegistry,
  RegistryFileNotFoundError,
  RegistrySourceError,
  resolveRef,
} from "./github-source";

const REGISTRY = join(import.meta.dir, "../../../registry");
let server: GithubRawServer | undefined;

function serve(ref = "v1.2.3"): GithubRawServer {
  server = serveGithubRaw({ registryDir: REGISTRY, ownerRepo: "acme/bg", ref });
  return server;
}

afterEach(() => {
  server?.stop();
  server = undefined;
});

describe("githubRegistry.read", () => {
  test("reads a repo-relative path at the ref", async () => {
    const raw = serve();
    const registry = githubRegistry("acme/bg", "v1.2.3", { baseUrl: raw.baseUrl });
    const text = await registry.read("registry/ui/button.tsx");
    expect(text).toContain("export function Button");
    expect(raw.requested).toEqual(["ui/button.tsx"]);
  });

  test("keeps the slashes of a branch ref", async () => {
    const raw = serve("feat/platform-cli-registry");
    const registry = githubRegistry("acme/bg", "feat/platform-cli-registry", {
      baseUrl: raw.baseUrl,
    });
    expect(await registry.read("registry/registry.json")).toContain('"name": "bonne-garde"');
  });

  test("a 404 says which file and which ref", async () => {
    const raw = serve();
    const registry = githubRegistry("acme/bg", "v1.2.3", { baseUrl: raw.baseUrl });
    const failure = await registry.read("registry/ui/nope.tsx").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RegistryFileNotFoundError);
    expect((failure as Error).message).toContain("registry/ui/nope.tsx");
    expect((failure as Error).message).toContain("github:acme/bg@v1.2.3");
  });

  test("another status names the status and points at GITHUB_TOKEN when it may be a rate limit", async () => {
    const limited = Bun.serve({
      hostname: "127.0.0.1",
      port: 0,
      fetch: () => new Response("slow down", { status: 429 }),
    });
    try {
      const registry = githubRegistry("acme/bg", "v1", { baseUrl: limited.url.origin });
      const failure = await registry.read("registry/registry.json").catch((e: unknown) => e);
      expect(failure).toBeInstanceOf(RegistrySourceError);
      expect(failure).not.toBeInstanceOf(RegistryFileNotFoundError);
      expect((failure as Error).message).toContain("429");
      expect((failure as Error).message).toContain("GITHUB_TOKEN");
    } finally {
      await limited.stop(true);
    }
  });

  test("an unreachable host names the url it tried", async () => {
    const gone = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response("") });
    const base = gone.url.origin;
    await gone.stop(true);
    const registry = githubRegistry("acme/bg", "v1", { baseUrl: base });
    const failure = await registry.read("registry/registry.json").catch((e: unknown) => e);
    expect(failure).toBeInstanceOf(RegistrySourceError);
    expect((failure as Error).message).toContain(`${base}/acme/bg/v1/registry/registry.json`);
  });

  test("a 404 on a request that carried a token says a stale token also looks like a 404", async () => {
    const raw = serve();
    const withToken = githubRegistry("acme/bg", "v1.2.3", { baseUrl: raw.baseUrl, token: "stale" });
    const without = githubRegistry("acme/bg", "v1.2.3", { baseUrl: raw.baseUrl });
    const asked = await withToken.read("registry/nope").catch((error: unknown) => error);
    const anonymous = await without.read("registry/nope").catch((error: unknown) => error);
    expect((asked as Error).message).toContain("GITHUB_TOKEN");
    expect((anonymous as Error).message).not.toContain("GITHUB_TOKEN");
  });

  test("sends the token as a bearer, and nothing without one", async () => {
    const raw = serve();
    await githubRegistry("acme/bg", "v1.2.3", { baseUrl: raw.baseUrl }).read(
      "registry/registry.json",
    );
    await githubRegistry("acme/bg", "v1.2.3", { baseUrl: raw.baseUrl, token: "t0ken" }).read(
      "registry/registry.json",
    );
    expect(raw.authorization).toEqual([null, "Bearer t0ken"]);
  });
});

describe("resolveRef", () => {
  test("keeps the ref the source names", () => {
    expect(resolveRef("acme/bg", "feat/x", "0.1.0")).toBe("feat/x");
  });

  test("a source with no ref is the platform tag, never a branch", () => {
    expect(resolveRef("acme/bg", undefined, "0.4.2")).toBe("v0.4.2");
    expect(resolveRef("acme/bg", undefined, "v0.4.2")).toBe("v0.4.2");
  });

  test("no ref and no platform version to derive one from is an error that says to pin one", () => {
    for (const version of [undefined, "0.0.0"]) {
      expect(() => resolveRef("acme/bg", undefined, version)).toThrow(/pin a ref/);
    }
  });
});
