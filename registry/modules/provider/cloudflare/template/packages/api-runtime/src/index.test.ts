import { describe, it, expect } from "vite-plus/test";
import { Elysia } from "elysia";
import { clientIpHeaders, readRuntimeEnv, registerUpgrade, runtimeOptions, serve } from "./index";

describe("runtimeOptions", () => {
  it("turns AOT compilation off, because Workers forbid new Function()", () => {
    const app = new Elysia(runtimeOptions);

    expect(app.config.aot).toBe(false);
  });

  it("builds an app that still answers requests", async () => {
    const app = new Elysia(runtimeOptions).get("/ping", () => "pong");

    const response = await app.handle(new Request("http://localhost/ping"));

    expect(await response.text()).toBe("pong");
  });
});

describe("clientIpHeaders", () => {
  it("names cf-connecting-ip, which Cloudflare's edge sets on every request and overwrites", () => {
    expect(clientIpHeaders).toEqual(["cf-connecting-ip"]);
  });
});

describe("readRuntimeEnv", () => {
  it("reads process.env where the Workers specifier does not resolve", async () => {
    process.env.API_RUNTIME_TEST_VAR = "from-process-env";
    try {
      const env = await readRuntimeEnv();

      expect(env.API_RUNTIME_TEST_VAR).toBe("from-process-env");
    } finally {
      delete process.env.API_RUNTIME_TEST_VAR;
    }
  });

  it("returns a copy, so writing to it leaves process.env alone", async () => {
    const env = await readRuntimeEnv();

    env.API_RUNTIME_TEST_VAR = "written";

    expect(Object.is(env, process.env)).toBe(false);
    expect(process.env.API_RUNTIME_TEST_VAR).toBeUndefined();
  });
});

describe("serve", () => {
  it("hands the request, env and ctx to the app's fetch and returns its response", async () => {
    const request = new Request("http://localhost/anything");
    const env = { DB: "binding" };
    const ctx = { waitUntil: () => {} };
    const seen: unknown[] = [];
    const response = new Response("from the app");
    const app = {
      fetch(...args: [Request, unknown, unknown]) {
        seen.push(...args);
        return response;
      },
    };

    const result = await serve(app).fetch(request, env, ctx);

    expect(seen).toEqual([request, env, ctx]);
    expect(result).toBe(response);
  });

  it("serves a real Elysia app built with the runtime options", async () => {
    const app = new Elysia(runtimeOptions).get("/health", () => ({ status: "ok" }));

    const response = await serve(app).fetch(new Request("http://localhost/health"), {}, {});

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });
});

describe("registerUpgrade", () => {
  const upgrade = (path: string) =>
    new Request(`http://localhost${path}`, { headers: { Upgrade: "WebSocket" } });

  /** Stands in for the app: records what reached it. */
  const recordingApp = () => {
    const reached: string[] = [];
    return {
      reached,
      fetch(request: Request) {
        reached.push(new URL(request.url).pathname);
        return new Response("from the app");
      },
    };
  };

  it("hands a WebSocket upgrade under the prefix to the handler, with env and ctx, not to the app", async () => {
    const app = recordingApp();
    const env = { ROOMS: "durable object namespace" };
    const ctx = { waitUntil: () => {} };
    const seen: unknown[] = [];
    // Not 101: outside workerd, `new Response(null, { status: 101 })` throws a RangeError.
    const unregister = registerUpgrade("/ws/rooms", (...args) => {
      seen.push(...args);
      return new Response("upgraded");
    });
    try {
      const request = upgrade("/ws/rooms/abc");

      const response = await serve(app).fetch(request, env, ctx);

      expect(await response.text()).toBe("upgraded");
      expect(seen).toEqual([request, env, ctx]);
      expect(app.reached).toEqual([]);
    } finally {
      unregister();
    }
  });

  it("leaves a plain request, an upgrade under another path and a longer segment to the app", async () => {
    const app = recordingApp();
    const unregister = registerUpgrade("/ws/rooms", () => new Response("upgraded"));
    try {
      const plain = new Request("http://localhost/ws/rooms");
      for (const request of [plain, upgrade("/ws/other"), upgrade("/ws/roomsx")]) {
        expect(await (await serve(app).fetch(request, {}, {})).text()).toBe("from the app");
      }
      expect(app.reached).toEqual(["/ws/rooms", "/ws/other", "/ws/roomsx"]);
    } finally {
      unregister();
    }
  });

  it("refuses a prefix that is already registered", () => {
    const unregister = registerUpgrade("/ws/rooms", () => new Response("upgraded"));
    try {
      expect(() => registerUpgrade("/ws/rooms", () => new Response("again"))).toThrow(
        /\/ws\/rooms/,
      );
    } finally {
      unregister();
    }
  });
});
