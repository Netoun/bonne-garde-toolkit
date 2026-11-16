import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { openapi } from "@elysiajs/openapi";
import { branding } from "{{SCOPE}}/config";

const app = new Elysia().use(
  openapi({
    documentation: { info: { title: `${branding.displayName} API`, version: "0.0.1" } },
  }),
);

describe("GET /openapi", () => {
  it("returns 200 with the API documentation page", async () => {
    const response = await app.handle(new Request("http://localhost/openapi"));

    expect(response.status).toBe(200);
  });
});
