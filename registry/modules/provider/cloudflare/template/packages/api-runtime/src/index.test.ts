import { afterEach, describe, it, expect } from "vite-plus/test";
import { Elysia } from "elysia";
import {
  clientIpHeaders,
  readRuntimeEnv,
  runtimeOptions,
  serve,
  wrapRequests,
  type RequestContext,
  type RequestWrapper,
} from "./index";

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
    const ctx: RequestContext = { waitUntil: () => {} };
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

    const response = await serve(app).fetch(
      new Request("http://localhost/health"),
      {},
      { waitUntil: () => {} },
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });
});

describe("wrapRequests", () => {
  const disposers: Array<() => void> = [];
  const register = (wrapper: RequestWrapper) => disposers.push(wrapRequests(wrapper));
  const app = { fetch: () => new Response("from the app") };

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it("leaves the response alone when no wrapper is registered", async () => {
    const response = new Response("untouched");

    const result = await serve({ fetch: () => response }).fetch(
      new Request("http://localhost/"),
      {},
      { waitUntil: () => {} },
    );

    expect(result).toBe(response);
  });

  it("calls a registered wrapper once per request, with the request, env and ctx", async () => {
    const calls: unknown[][] = [];
    register((request, env, ctx, next) => {
      calls.push([request, env, ctx]);
      return next();
    });
    const request = new Request("http://localhost/one");
    const env = { SENTRY_DSN: "dsn" };
    const ctx: RequestContext = { waitUntil: () => {} };

    const response = await serve(app).fetch(request, env, ctx);
    await serve(app).fetch(new Request("http://localhost/two"), env, ctx);

    expect(calls).toHaveLength(2);
    expect(calls[0]).toEqual([request, env, ctx]);
    expect(await response.text()).toBe("from the app");
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

    const response = await serve(app).fetch(
      new Request("http://localhost/"),
      {},
      {
        waitUntil: () => {},
      },
    );

    expect(order).toEqual(["first in", "second", "first out"]);
    expect(await response.text()).toBe("from the app, wrapped");
  });

  it("stops calling a wrapper once it is disposed", async () => {
    let calls = 0;
    const dispose = wrapRequests((_request, _env, _ctx, next) => {
      calls += 1;
      return next();
    });

    dispose();
    await serve(app).fetch(new Request("http://localhost/"), {}, { waitUntil: () => {} });

    expect(calls).toBe(0);
  });
});
