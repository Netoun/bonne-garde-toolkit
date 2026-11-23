import { randomBytes } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  clientIpHeaders,
  handler,
  listenPort,
  readRuntimeEnv,
  registerUpgrade,
  runtimeOptions,
  serve,
  wrapRequests,
  type IncomingRequest,
  type RequestWrapper,
} from "./index";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "api-runtime-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("runtimeOptions", () => {
  it("keeps ahead-of-time compilation on and leaves the adapter to Elysia's runtime default", () => {
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

  it("does not invent a storage key: R2_PUBLIC_URL is the storage module's, and this provider has no bucket", async () => {
    const env = await readRuntimeEnv({ APP_URL: "https://app.example.com/", DATA_DIR: dir });

    expect(env.R2_PUBLIC_URL).toBeUndefined();
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

  it("listens on the port it is given, else on PORT, else on 5172", () => {
    const previous = process.env.PORT;
    try {
      expect(listenPort(4321)).toBe(4321);
      process.env.PORT = "4000";
      expect(listenPort()).toBe(4000);
      delete process.env.PORT;
      expect(listenPort()).toBe(5172);
    } finally {
      if (previous === undefined) delete process.env.PORT;
      else process.env.PORT = previous;
    }
  });

  it("serves over HTTP, and stops on SIGTERM, which PID 1 of a container would otherwise ignore", async () => {
    const before = process.listenerCount("SIGTERM");
    const servers = [await serve(app, { spaDir, port: 0 }), await serve(app, { spaDir, port: 0 })];
    try {
      const [first] = servers;
      const response = await fetch(new URL("/health", first?.url));

      expect(await response.json()).toMatchObject({ status: "ok" });
      // Once, however many times `serve` is called: no listener leak, no MaxListeners warning.
      expect(process.listenerCount("SIGTERM")).toBeLessThanOrEqual(before + 1);
      expect(process.listenerCount("SIGTERM")).toBeGreaterThan(0);
    } finally {
      await Promise.all(servers.map((server) => server.close(true)));
    }
  });

  it("serves the SPA's index.html at the root", async () => {
    const response = await handler(app, { spaDir })(new Request("http://localhost/"));

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toBe("<html>the spa</html>");
  });

  it("serves a built asset with its content type", async () => {
    const response = await handler(app, { spaDir })(
      new Request("http://localhost/assets/app-abc123.js"),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toBe("console.log('spa');");
  });

  it("hands a path that is not a built file to the app", async () => {
    const response = await handler(app, { spaDir })(
      new Request("http://localhost/health", navigation),
    );

    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("falls back to index.html when a browser navigates to a route only the SPA knows", async () => {
    const response = await handler(app, { spaDir })(
      new Request("http://localhost/organizations/acme/members", navigation),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("<html>the spa</html>");
  });

  it("keeps the app's 404 for a client that did not ask for HTML", async () => {
    const response = await handler(app, { spaDir })(
      new Request("http://localhost/v1/nothing", { headers: { accept: "application/json" } }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("keeps the app's 404 for a missing asset, rather than answering it with HTML", async () => {
    const response = await handler(app, { spaDir })(
      new Request("http://localhost/assets/missing.js", { headers: { accept: "*/*" } }),
    );

    expect(response.status).toBe(404);
  });

  it("does not answer a write with the SPA, even from a browser", async () => {
    const response = await handler(app, { spaDir })(
      new Request("http://localhost/dashboard", { method: "POST", ...navigation }),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("never serves a file outside the SPA directory", async () => {
    await writeFile(join(dir, "outside.txt"), "not for the web");

    const response = await handler(app, { spaDir })(
      new Request("http://localhost/..%2foutside.txt", navigation),
    );

    expect(await response.text()).not.toContain("not for the web");
  });

  it("hands a malformed path to the app instead of throwing", async () => {
    const response = await handler(app, { spaDir })(new Request("http://localhost/%E0%A4%A"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("does not answer a directory with its listing or an error", async () => {
    const response = await handler(app, { spaDir })(new Request("http://localhost/assets"));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });

  it("serves only the app when no SPA has been built", async () => {
    const missing = join(dir, "not-built");

    const response = await handler(app, { spaDir: missing })(
      new Request("http://localhost/dashboard", navigation),
    );

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("api: not found");
  });
});

describe("the client's address", () => {
  /** Stands in for the app: answers with the address the runtime stamped on the request. */
  const echo = {
    fetch: (request: Request) => Response.json({ ip: request.headers.get("x-client-ip") }),
  };
  /** The request as the server hands it over, from a socket whose peer is `address`. */
  const from = (request: Request, address?: string): IncomingRequest =>
    Object.assign(request, { ip: address });
  const addressOf = async (response: Response) => ((await response.json()) as { ip: unknown }).ip;
  const spaDir = () => join(dir, "no-spa");

  it("names x-client-ip, the header serve fills, as the one the rate limit reads", () => {
    expect(clientIpHeaders).toEqual(["x-client-ip"]);
  });

  it("stamps the address of the socket on the request the app sees", async () => {
    const response = await handler(echo, { spaDir: spaDir() })(
      from(new Request("http://localhost/who"), "203.0.113.7"),
    );

    expect(await addressOf(response)).toBe("203.0.113.7");
  });

  it("drops an x-client-ip a client sent: the header is the runtime's, whoever it claims to be", async () => {
    const forged = new Request("http://localhost/who", {
      headers: { "x-client-ip": "198.51.100.1" },
    });

    const withSocket = await handler(echo, { spaDir: spaDir() })(from(forged, "203.0.113.7"));
    const withoutSocket = await handler(echo, { spaDir: spaDir() })(from(forged));

    expect(await addressOf(withSocket)).toBe("203.0.113.7");
    expect(await addressOf(withoutSocket)).toBeNull();
  });

  it("does not trust x-forwarded-for: with the port published, any client can send it", async () => {
    const forged = new Request("http://localhost/who", {
      headers: { "x-forwarded-for": "198.51.100.1" },
    });

    const response = await handler(echo, { spaDir: spaDir() })(from(forged, "203.0.113.7"));

    expect(await addressOf(response)).toBe("203.0.113.7");
  });

  it("takes the address from the header the operator names, last entry, when a proxy sits in front", async () => {
    // The proxy appends what it saw to what the client sent, so only the last entry is its own.
    const behindProxy = new Request("http://localhost/who", {
      headers: { "x-forwarded-for": "198.51.100.1, 203.0.113.9" },
    });

    const response = await handler(echo, {
      spaDir: spaDir(),
      trustedProxyHeader: "x-forwarded-for",
    })(from(behindProxy, "172.18.0.1"));

    expect(await addressOf(response)).toBe("203.0.113.9");
  });

  it("falls back to the socket when the named header is absent, and reads TRUSTED_PROXY_HEADER by default", async () => {
    const previous = process.env.TRUSTED_PROXY_HEADER;
    try {
      process.env.TRUSTED_PROXY_HEADER = "x-real-ip";
      const answer = handler(echo, { spaDir: spaDir() });

      const named = await answer(
        from(
          new Request("http://localhost/who", { headers: { "x-real-ip": "203.0.113.9" } }),
          "172.18.0.1",
        ),
      );
      const absent = await answer(from(new Request("http://localhost/who"), "172.18.0.1"));

      expect(await addressOf(named)).toBe("203.0.113.9");
      expect(await addressOf(absent)).toBe("172.18.0.1");
    } finally {
      if (previous === undefined) delete process.env.TRUSTED_PROXY_HEADER;
      else process.env.TRUSTED_PROXY_HEADER = previous;
    }
  });

  it("keeps the body of a write, which stamping the header must not consume", async () => {
    const reader = { fetch: async (request: Request) => new Response(await request.text()) };

    const response = await handler(reader, { spaDir: spaDir() })(
      from(new Request("http://localhost/echo", { method: "POST", body: "hello" }), "203.0.113.7"),
    );

    expect(await response.text()).toBe("hello");
  });

  it("stamps the address of the socket a real request came from", async () => {
    const server = await serve(echo, { spaDir: spaDir(), port: 0 });
    try {
      const response = await fetch(new URL("/who", server.url), {
        headers: { "x-client-ip": "198.51.100.1" },
      });

      expect(await addressOf(response)).toMatch(/^(?:::1|::ffff:127\.0\.0\.1|127\.0\.0\.1)$/);
    } finally {
      await server.close(true);
    }
  });
});

describe("registerUpgrade", () => {
  /** Stands in for the app: answers /health, and records every path that reached it. */
  const reached: string[] = [];
  const app = {
    fetch(request: Request) {
      const { pathname } = new URL(request.url);
      reached.push(pathname);
      return pathname === "/health"
        ? Response.json({ status: "ok" })
        : new Response("api: not found", { status: 404 });
    },
  };

  /** The status a WebSocket handshake to `url` is answered with: 101 when it upgrades. */
  const handshakeStatus = (url: URL) =>
    new Promise<number>((resolve, reject) => {
      const request = httpRequest(url, {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": randomBytes(16).toString("base64"),
        },
      });
      request.on("upgrade", (_response, socket) => {
        socket.destroy();
        resolve(101);
      });
      request.on("response", (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
      request.end();
    });

  it("echoes over a WebSocket under the prefix, beside the app, and refuses one under no prefix", async () => {
    const unregister = registerUpgrade("/ws/echo", {
      message(peer, message) {
        peer.send(message.text());
      },
    });
    const server = await serve(app, { spaDir: join(dir, "no-spa"), port: 0 });
    try {
      const url = new URL("/ws/echo", server.url);
      url.protocol = "ws:";
      const socket = new WebSocket(url);
      const opened = new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve);
        socket.addEventListener("error", reject);
      });
      const echoed = new Promise((resolve) => {
        socket.addEventListener("message", (event) => resolve(event.data));
      });
      const closed = new Promise((resolve) => socket.addEventListener("close", resolve));
      await opened;
      socket.send("hello");

      expect(await echoed).toBe("hello");
      socket.close();
      await closed;

      const health = await fetch(new URL("/health", server.url));
      expect(await health.json()).toMatchObject({ status: "ok" });

      expect(await handshakeStatus(new URL("/ws/other", server.url))).toBe(404);
      expect(reached).toEqual(["/health"]);
    } finally {
      unregister();
      await server.close(true);
    }
  });

  it("refuses a prefix that is already registered", () => {
    const unregister = registerUpgrade("/ws/echo", {});
    try {
      expect(() => registerUpgrade("/ws/echo", {})).toThrow(/\/ws\/echo/);
    } finally {
      unregister();
    }
  });
});

describe("wrapRequests", () => {
  const disposers: Array<() => void> = [];
  const register = (wrapper: RequestWrapper) => disposers.push(wrapRequests(wrapper));
  const app = {
    fetch: (request: Request) => new Response(`app: ${new URL(request.url).pathname}`),
  };
  const spaDir = () => join(dir, "client");

  beforeEach(async () => {
    await mkdir(spaDir(), { recursive: true });
    await writeFile(join(spaDir(), "index.html"), "<html>the spa</html>");
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it("leaves the app's response alone when no wrapper is registered", async () => {
    const response = new Response("untouched");

    const result = await handler(
      { fetch: () => response },
      { spaDir: spaDir() },
    )(new Request("http://localhost/api"));

    expect(result).toBe(response);
  });

  it("calls a registered wrapper once per request the app answers, with the request, env and ctx", async () => {
    const calls: Array<{ request: Request; env: unknown; ctx: unknown }> = [];
    register((request, env, ctx, next) => {
      calls.push({ request, env, ctx });
      return next();
    });
    const serveRequest = handler(app, { spaDir: spaDir() });

    const response = await serveRequest(new Request("http://localhost/api"));
    await serveRequest(new Request("http://localhost/index.html"));

    // The built file is the server's own answer, not the app's: no wrapper runs for it.
    expect(calls).toHaveLength(1);
    expect(calls[0]?.request.url).toBe("http://localhost/api");
    expect(calls[0]?.env).toBe(process.env);
    expect(calls[0]?.ctx).toEqual({ waitUntil: expect.any(Function) });
    expect(await response.text()).toBe("app: /api");
  });

  it("runs wrappers in registration order, the first one outermost, and lets one replace the response", async () => {
    const order: string[] = [];
    register(async (_request, _env, _ctx, next) => {
      order.push("first in");
      const response = await next();
      order.push("first out");
      return new Response(`${await response.text()}, wrapped`);
    });
    register((_request, _env, _ctx, next) => {
      order.push("second");
      return next();
    });

    const response = await handler(app, { spaDir: spaDir() })(new Request("http://localhost/x"));

    expect(order).toEqual(["first in", "second", "first out"]);
    expect(await response.text()).toBe("app: /x, wrapped");
  });

  it("logs work handed to waitUntil that rejects, instead of failing the process", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const failure = new Error("flush failed");
    register((_request, _env, ctx, next) => {
      ctx.waitUntil(Promise.reject(failure));
      return next();
    });

    try {
      const response = await handler(app, { spaDir: spaDir() })(new Request("http://localhost/x"));
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(response.status).toBe(200);
      expect(logged).toHaveBeenCalledWith(failure);
    } finally {
      logged.mockRestore();
    }
  });
});

describe("registerUpgrade with wrapRequests", () => {
  it("answers an upgrade under a registered prefix without the wrappers, which still run around a plain request", async () => {
    const seen: string[] = [];
    const unwrap = wrapRequests(async (request, _env, _ctx, next) => {
      seen.push(new URL(request.url).pathname);
      const response = await next();
      return new Response(response.body, response);
    });
    const unregister = registerUpgrade("/ws/echo", {});
    const app = { fetch: () => Response.json({ status: "ok" }) };
    const server = await serve(app, { spaDir: join(dir, "no-spa"), port: 0 });
    try {
      const url = new URL("/ws/echo/abc", server.url);
      url.protocol = "ws:";
      const socket = new WebSocket(url);
      await new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve);
        socket.addEventListener("error", reject);
      });
      const closed = new Promise((resolve) => socket.addEventListener("close", resolve));
      socket.close();
      await closed;

      const health = await fetch(new URL("/health", server.url));

      expect(await health.json()).toMatchObject({ status: "ok" });
      expect(seen).toEqual(["/health"]);
    } finally {
      unwrap();
      unregister();
      await server.close(true);
    }
  });
});
