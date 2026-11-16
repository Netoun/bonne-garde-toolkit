import { describe, it, expect } from "bun:test";
import { app } from "./app";

describe("app", () => {
  it("answers GET /health with the status ok", async () => {
    const response = await app.handle(new Request("http://localhost/health"));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "ok" });
  });

  it("answers an unknown route with 404", async () => {
    const response = await app.handle(new Request("http://localhost/no-such-route"));

    expect(response.status).toBe(404);
  });
});
