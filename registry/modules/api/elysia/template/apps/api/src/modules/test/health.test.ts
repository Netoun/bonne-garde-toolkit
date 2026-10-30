import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { treaty } from "@elysiajs/eden";

const app = new Elysia().get("/health", () => ({ status: "ok", timestamp: Date.now() }));
const api = treaty(app);

describe("GET /health", () => {
  it("returns 200 with status ok", async () => {
    const { data, error } = await api.health.get();

    expect(error).toBeNull();
    expect(data?.status).toBe("ok");
    expect(typeof data?.timestamp).toBe("number");
  });
});
