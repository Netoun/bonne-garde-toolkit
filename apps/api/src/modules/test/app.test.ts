import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { treaty } from "@elysiajs/eden";
import { createTestDb } from "./db.test";

export function createTestApp() {
  const db = createTestDb();

  const app = new Elysia()
    .use(cors())
    .decorate("db", db)
    .decorate("env", {
      BETTER_AUTH_SECRET: "test-secret-32-chars-long-for-testing",
      RESEND_API_KEY: "test",
      R2_PUBLIC_URL: "http://localhost/media",
      SPA_URL: "http://localhost:5173",
      SSR_URL: "http://localhost:5174",
    })
    .get("/health", () => ({ status: "ok", timestamp: Date.now() }));

  return { app, db, api: treaty(app) };
}

export type TestApp = ReturnType<typeof createTestApp>;
