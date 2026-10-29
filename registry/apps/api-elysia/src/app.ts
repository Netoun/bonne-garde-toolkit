import { Elysia } from "elysia";

export const app = new Elysia({ aot: false }).get("/health", () => ({
  status: "ok",
  timestamp: Date.now(),
}));

export type App = typeof app;
