import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { readRuntimeEnv, runtimeOptions, serve } from "./index";

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
