import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Elysia, status, t } from "elysia";
import { handleError } from "./errors";

const app = new Elysia()
  .onError(handleError)
  .get("/boom", () => {
    throw new Error("secret");
  })
  .get("/teapot", () => {
    throw status(418, { error: "short and stout" });
  })
  .get("/unavailable", () => {
    throw status(503, { error: "maintenance" });
  })
  .post("/items", ({ body }) => body, { body: t.Object({ name: t.String() }) });

describe("handleError", () => {
  let lines: string[];

  beforeEach(() => {
    lines = [];
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
      lines.push(args[0] as string);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  const errorLogs = () => lines.map((line) => JSON.parse(line) as Record<string, unknown>);

  it("answers an unexpected error with an opaque 500 and logs it once", async () => {
    const res = await app.handle(new Request("http://localhost/boom?q=1"));
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "Internal Server Error" });
    expect(text).not.toContain("secret");

    const logs = errorLogs();
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({
      level: "error",
      method: "GET",
      path: "/boom",
      error: { message: "secret" },
    });
  });

  it("treats a thrown status(5xx) as unexpected", async () => {
    const res = await app.handle(new Request("http://localhost/unavailable"));
    const text = await res.text();

    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ error: "Internal Server Error" });
    expect(errorLogs()).toHaveLength(1);
  });

  it("leaves an unknown route to Elysia: 404, nothing logged", async () => {
    const res = await app.handle(new Request("http://localhost/nope"));

    expect(res.status).toBe(404);
    expect(lines).toHaveLength(0);
  });

  it("leaves a failed validation to Elysia: 422, nothing logged", async () => {
    const res = await app.handle(
      new Request("http://localhost/items", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name: 1 }),
      }),
    );

    expect(res.status).toBe(422);
    expect(lines).toHaveLength(0);
  });

  it("leaves a thrown status(4xx) to Elysia: same response, nothing logged", async () => {
    const res = await app.handle(new Request("http://localhost/teapot"));

    expect(res.status).toBe(418);
    expect(await res.json()).toEqual({ error: "short and stout" });
    expect(lines).toHaveLength(0);
  });
});
