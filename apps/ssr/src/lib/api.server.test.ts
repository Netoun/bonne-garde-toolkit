import { RouterContextProvider } from "react-router";
import { http, HttpResponse } from "msw";
import { afterEach, expect, it, vi } from "vite-plus/test";
import { server } from "../../../../testing/server";
import { cloudflareContext } from "./cloudflare-context";
import { createApi } from "./api.server";

afterEach(() => vi.unstubAllEnvs());

it("uses typed Worker context and forwards the request cookie through Eden", async () => {
  const context = new RouterContextProvider();
  context.set(cloudflareContext, {
    env: { API_URL: "https://api.example.test" },
    ctx: {
      waitUntil() {},
      passThroughOnException() {},
      props: {},
      exports: {},
      tracing: {
        enterSpan() {
          throw new Error("Tracing is not used in this test");
        },
        startActiveSpan() {
          throw new Error("Tracing is not used in this test");
        },
        Span: class {
          isTraced = false;
          setAttribute() {}
          end() {}
        },
      },
    },
  });
  let cookie: string | null = null;
  server.use(
    http.get("https://api.example.test/v1/media/test-media", ({ request }) => {
      cookie = request.headers.get("cookie");
      return HttpResponse.json({ id: "test-media", name: "image.jpg" });
    }),
  );
  const api = createApi(
    context,
    new Request("https://app.example.test", {
      headers: { cookie: "session=example" },
    }),
  );
  const { data, error } = await api.media({ id: "test-media" }).get();
  expect(error).toBeNull();
  expect(data).toMatchObject({ id: "test-media" });
  expect(cookie).toBe("session=example");
});

it("requires Worker API configuration in production", () => {
  vi.stubEnv("DEV", false);
  expect(() => createApi(new RouterContextProvider())).toThrow("Missing API_URL");
});

it("allows the documented localhost fallback during development", () => {
  vi.stubEnv("DEV", true);
  expect(() => createApi(new RouterContextProvider())).not.toThrow();
});
