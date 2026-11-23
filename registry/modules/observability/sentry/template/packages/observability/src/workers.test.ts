import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Sentry from "@sentry/cloudflare";
import { Elysia, status, t } from "elysia";
import { serve, wrapRequests, type RequestContext } from "{{SCOPE}}/api-runtime";
import { createObservability } from "./workers";

const DSN = "https://public@sentry.example.com/1";

describe("createObservability", () => {
  let events: Sentry.ErrorEvent[];
  /** Whether a Sentry client was active while the route ran: the per-request one, on Workers. */
  let clientInRoute: boolean | undefined;
  /** What the runtime keeps alive after the response; the test awaits it, as Workers would. */
  let pending: Promise<unknown>[];
  const disposers: Array<() => void> = [];
  const ctx: RequestContext = { waitUntil: (promise) => void pending.push(promise) };
  const record = {
    beforeSend: (event: Sentry.ErrorEvent) => {
      events.push(event);
      return event;
    },
    // Nothing leaves the process: an event is kept by `beforeSend` and the transport drops it.
    transport: () => ({ send: async () => ({}), flush: async () => true }),
  };

  /** What `apps/api` builds: the plugin first, then the app's own `onError`, served by api-runtime. */
  function served(env: Record<string, unknown>) {
    const { plugin, wrapper } = createObservability(env, record);
    if (wrapper) disposers.push(wrapRequests(wrapper));
    const app = new Elysia()
      .use(plugin)
      .onError(({ error }) => {
        if (error instanceof Error && error.message === "boom") {
          return status(500, { error: "Internal Server Error" });
        }
      })
      .get("/boom", () => {
        clientInRoute = Sentry.getClient() !== undefined;
        throw new Error("boom");
      })
      .get("/teapot", () => {
        throw status(418, { error: "short and stout" });
      })
      .post("/items", ({ body }) => body, { body: t.Object({ name: t.String() }) });
    return async (request: Request) => {
      const response = await serve(app).fetch(request, env, ctx);
      await Promise.all(pending);
      return response;
    };
  }

  beforeEach(() => {
    events = [];
    pending = [];
    clientInRoute = undefined;
  });

  afterEach(() => {
    for (const dispose of disposers.splice(0)) dispose();
  });

  it("does nothing without SENTRY_DSN: no client, and an error still answers 500", async () => {
    const fetch = served({});

    const res = await fetch(new Request("http://localhost/boom"));

    expect(clientInRoute).toBe(false);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    expect(events).toHaveLength(0);
  });

  it("treats a blank SENTRY_DSN as unset", () => {
    expect(createObservability({ SENTRY_DSN: "" }, record).wrapper).toBeUndefined();
  });

  it("captures an unexpected error once and leaves the response to the app's onError", async () => {
    const fetch = served({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "test" });

    const res = await fetch(new Request("http://localhost/boom"));

    expect(clientInRoute).toBe(true);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    expect(events).toHaveLength(1);
    expect(events[0]?.exception?.values?.[0]?.value).toBe("boom");
    expect(events[0]?.environment).toBe("test");
  });

  it("sends nothing for a 404, a 422 or a thrown status(4xx)", async () => {
    const fetch = served({ SENTRY_DSN: DSN });

    const missing = await fetch(new Request("http://localhost/nope"));
    const invalid = await fetch(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 1 }),
      }),
    );
    const teapot = await fetch(new Request("http://localhost/teapot"));

    expect([missing.status, invalid.status, teapot.status]).toEqual([404, 422, 418]);
    expect(events).toHaveLength(0);
  });
});
