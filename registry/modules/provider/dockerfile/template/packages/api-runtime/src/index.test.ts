import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuntimeEnv, runtimeOptions, serve } from "./index";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "api-runtime-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runtimeOptions", () => {
  it("keeps ahead-of-time compilation on and leaves the adapter to Elysia's Bun default", () => {
    expect(runtimeOptions).toEqual({ aot: true });
  });
});

describe("readRuntimeEnv", () => {
  it("returns a copy of its source, so writing to it leaves the source alone", async () => {
    const source = { SOME_VAR: "kept", BETTER_AUTH_SECRET: "set" };

    const env = await readRuntimeEnv(source);
    env.SOME_VAR = "written";

    expect(source.SOME_VAR).toBe("kept");
  });

  it("reads process.env when no source is given", async () => {
    process.env.API_RUNTIME_TEST_VAR = "from-process-env";
    try {
      const env = await readRuntimeEnv();

      expect(env.API_RUNTIME_TEST_VAR).toBe("from-process-env");
    } finally {
      delete process.env.API_RUNTIME_TEST_VAR;
    }
  });

  it("points the SPA, SSR and API urls at APP_URL, the one origin of the container", async () => {
    const env = await readRuntimeEnv({ APP_URL: "https://app.example.com", DATA_DIR: dir });

    expect(env).toMatchObject({
      SPA_URL: "https://app.example.com",
      SSR_URL: "https://app.example.com",
      API_URL: "https://app.example.com",
    });
  });

  it("keeps a url that was set explicitly, so a split deployment still works", async () => {
    const env = await readRuntimeEnv({
      APP_URL: "https://app.example.com",
      SPA_URL: "https://spa.example.com",
      DATA_DIR: dir,
    });

    expect(env.SPA_URL).toBe("https://spa.example.com");
    expect(env.API_URL).toBe("https://app.example.com");
  });

  it("derives R2_PUBLIC_URL from APP_URL, the media route being on the same origin", async () => {
    const env = await readRuntimeEnv({ APP_URL: "https://app.example.com/", DATA_DIR: dir });

    expect(env.R2_PUBLIC_URL).toBe("https://app.example.com/v1/media/file");
  });

  it("falls back to localhost on PORT when APP_URL is unset", async () => {
    const env = await readRuntimeEnv({ PORT: "4000", DATA_DIR: dir });

    expect(env.APP_URL).toBeUndefined();
    expect(env.API_URL).toBe("http://localhost:4000");
  });

  it("does not invent an email key: a missing RESEND_API_KEY stays missing", async () => {
    const env = await readRuntimeEnv({ DATA_DIR: dir });

    expect(env.RESEND_API_KEY).toBeUndefined();
  });

  describe("BETTER_AUTH_SECRET", () => {
    const secretFile = () => join(dir, "secrets", "better-auth-secret");

    it("keeps a secret that was set", async () => {
      const env = await readRuntimeEnv({ BETTER_AUTH_SECRET: "from-the-operator", DATA_DIR: dir });

      expect(env.BETTER_AUTH_SECRET).toBe("from-the-operator");
      expect(await stat(secretFile()).catch(() => null)).toBeNull();
    });

    it("generates one under DATA_DIR when unset, long enough for Better Auth", async () => {
      const env = await readRuntimeEnv({ DATA_DIR: dir });

      expect(String(env.BETTER_AUTH_SECRET).length).toBeGreaterThanOrEqual(32);
      expect(await readFile(secretFile(), "utf8")).toBe(env.BETTER_AUTH_SECRET as string);
    });

    it("treats an empty value as unset, since compose passes an empty string for a blank var", async () => {
      const env = await readRuntimeEnv({ BETTER_AUTH_SECRET: "", DATA_DIR: dir });

      expect(String(env.BETTER_AUTH_SECRET).length).toBeGreaterThanOrEqual(32);
    });

    it("writes the file readable by its owner only", async () => {
      await readRuntimeEnv({ DATA_DIR: dir });

      expect((await stat(secretFile())).mode & 0o777).toBe(0o600);
    });

    it("returns the same secret on the next start", async () => {
      const first = await readRuntimeEnv({ DATA_DIR: dir });
      const second = await readRuntimeEnv({ DATA_DIR: dir });

      expect(second.BETTER_AUTH_SECRET).toBe(first.BETTER_AUTH_SECRET as string);
    });

    it("yields one secret when many starts race, never two", async () => {
      const envs = await Promise.all(
        Array.from({ length: 24 }, () => readRuntimeEnv({ DATA_DIR: dir })),
      );

      const secrets = new Set(envs.map((env) => env.BETTER_AUTH_SECRET));
      expect(secrets.size).toBe(1);
      expect(await readFile(secretFile(), "utf8")).toBe([...secrets][0] as string);
    });

    it("writes nothing under NODE_ENV=test, where the app fills its own fixture", async () => {
      const env = await readRuntimeEnv({ NODE_ENV: "test", DATA_DIR: dir });

      expect(env.BETTER_AUTH_SECRET).toBeUndefined();
      expect(await stat(join(dir, "secrets")).catch(() => null)).toBeNull();
    });
  });
});

describe("serve", () => {
  let spaDir: string;

  /** Stands in for the Elysia app: answers /health, and 404 for everything else. */
  const app = {
    fetch(request: Request) {
      const { pathname } = new URL(request.url);
      return pathname === "/health"
        ? Response.json({ status: "ok" })
        : new Response("api: not found", { status: 404 });
    },
  };

  const navigation = { headers: { accept: "text/html,application/xhtml+xml,*/*;q=0.8" } };

  beforeEach(async () => {
    spaDir = join(dir, "client");
    await mkdir(join(spaDir, "assets"), { recursive: true });
    await writeFile(join(spaDir, "index.html"), "<html>the spa</html>");
    await writeFile(join(spaDir, "assets", "app-abc123.js"), "console.log('spa');");
  });

  it("listens on the port it is given", () => {
    expect(serve(app, { spaDir, port: 4321 }).port).toBe(4321);
  });

  it("listens on PORT, or on 5172 when it is unset", () => {
    const previous = process.env.PORT;
    try {
      process.env.PORT = "4000";
      expect(serve(app, { spaDir }).port).toBe(4000);

      delete process.env.PORT;
      expect(serve(app, { spaDir }).port).toBe(5172);
    } finally {
      if (previous === undefined) delete process.env.PORT;
      else process.env.PORT = previous;
    }
  });

  it("stops on SIGTERM, which PID 1 of a container would otherwise ignore", () => {
    const before = process.listenerCount("SIGTERM");

    serve(app, { spaDir });
    serve(app, { spaDir });

    // Once, however many times `serve` is called: no listener leak, no MaxListeners warning.
    expect(process.listenerCount("SIGTERM")).toBeLessThanOrEqual(before + 1);
    expect(process.listenerCount("SIGTERM")).toBeGreaterThan(0);
  });

  it("serves the SPA's index.html at the root", async () => {
    const response = await serve(app, { spaDir }).fetch(new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<html>the spa</html>");
  });

  it("serves a built asset with its content type", async () => {
    const response = await serve(app, { spaDir }).fetch(
      new Request("http://localhost/assets/app-abc123.js"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe("console.log('spa');");
  });

  it("hands a path that is not a built file to the app", async () => {
    const response = await serve(app, { spaDir }).fetch(
      new Request("http://localhost/health", navigation),
    );

    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("falls back to index.html when a browser navigates to a route only the SPA knows", async () => {
    const response = await serve(app, { spaDir }).fetch(
      new Request("http://localhost/organizations/acme/members", navigation),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>the spa</html>");
  });

  it("keeps the app's 404 for a client that did not ask for HTML", async () => {
    const response = await serve(app, { spaDir }).fetch(
      new Request("http://localhost/v1/nothing", { headers: { accept: "application/json" } }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("keeps the app's 404 for a missing asset, rather than answering it with HTML", async () => {
    const response = await serve(app, { spaDir }).fetch(
      new Request("http://localhost/assets/missing.js", { headers: { accept: "*/*" } }),
    );

    expect(response.status).toBe(404);
  });

  it("does not answer a write with the SPA, even from a browser", async () => {
    const response = await serve(app, { spaDir }).fetch(
      new Request("http://localhost/dashboard", { method: "POST", ...navigation }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("never serves a file outside the SPA directory", async () => {
    await writeFile(join(dir, "outside.txt"), "not for the web");

    const response = await serve(app, { spaDir }).fetch(
      new Request("http://localhost/..%2foutside.txt", navigation),
    );

    expect(await response.text()).not.toContain("not for the web");
  });

  it("hands a malformed path to the app instead of throwing", async () => {
    const response = await serve(app, { spaDir }).fetch(new Request("http://localhost/%E0%A4%A"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("does not answer a directory with its listing or an error", async () => {
    const response = await serve(app, { spaDir }).fetch(new Request("http://localhost/assets"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("serves only the app when no SPA has been built", async () => {
    const missing = join(dir, "not-built");

    const response = await serve(app, { spaDir: missing }).fetch(
      new Request("http://localhost/dashboard", navigation),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });
});
