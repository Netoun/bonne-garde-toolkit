import { describe, expect, test } from "bun:test";
import { app } from "./app";

describe("api-elysia health", () => {
  test("returns ok", async () => {
    const response = await app.handle(new Request("http://localhost/health"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe("ok");
  });
});
