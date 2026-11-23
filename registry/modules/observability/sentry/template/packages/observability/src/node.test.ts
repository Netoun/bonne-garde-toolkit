import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import * as Sentry from "@sentry/node";
import { Elysia, status, t } from "elysia";
import { createObservability } from "./node";

const DSN = "https://public@sentry.example.com/1";

/** What the app writes for an unexpected error: registered after the plugin, as `apps/api` does. */
function appWith(plugin: Elysia) {
  return new Elysia()
    .use(plugin)
    .onError(({ error }) => {
      if (error instanceof Error && error.message === "boom") {
        return status(500, { error: "Internal Server Error" });
      }
    })
    .get("/boom", () => {
      throw new Error("boom");
    })
    .get("/teapot", () => {
      throw status(418, { error: "short and stout" });
    })
    .post("/items", ({ body }) => body, { body: t.Object({ name: t.String() }) });
}

describe("createObservability", () => {
  let events: Sentry.ErrorEvent[];
  const record = {
    beforeSend: (event: Sentry.ErrorEvent) => {
      events.push(event);
      return event;
    },
    // Nothing leaves the process: an event is kept by `beforeSend` and the transport drops it.
    transport: () => ({ send: async () => ({}), flush: async () => true }),
  };

  beforeEach(async () => {
    events = [];
    await Sentry.close();
  });

  afterEach(async () => {
    await Sentry.close();
  });

  it("does nothing without SENTRY_DSN: no client, and an error still answers 500", async () => {
    const app = appWith(createObservability({}, record));

    const res = await app.handle(new Request("http://localhost/boom"));

    expect(Sentry.getClient()).toBeUndefined();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    expect(events).toHaveLength(0);
  });

  it("treats a blank SENTRY_DSN as unset", () => {
    createObservability({ SENTRY_DSN: "" }, record);

    expect(Sentry.getClient()).toBeUndefined();
  });

  it("captures an unexpected error once and leaves the response to the app's onError", async () => {
    const app = appWith(
      createObservability({ SENTRY_DSN: DSN, SENTRY_ENVIRONMENT: "test" }, record),
    );

    const res = await app.handle(new Request("http://localhost/boom"));
    await Sentry.flush();

    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal Server Error" });
    expect(events).toHaveLength(1);
    expect(events[0]?.exception?.values?.[0]?.value).toBe("boom");
    expect(events[0]?.environment).toBe("test");
  });

  it("sends nothing for a 404, a 422 or a thrown status(4xx)", async () => {
    const app = appWith(createObservability({ SENTRY_DSN: DSN }, record));

    const missing = await app.handle(new Request("http://localhost/nope"));
    const invalid = await app.handle(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 1 }),
      }),
    );
    const teapot = await app.handle(new Request("http://localhost/teapot"));
    await Sentry.flush();

    expect([missing.status, invalid.status, teapot.status]).toEqual([404, 422, 418]);
    expect(events).toHaveLength(0);
  });
});
