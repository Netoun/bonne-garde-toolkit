import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // The barrel, not a glob: a test or a helper next to a schema file is never loaded by drizzle-kit.
  schema: "./src/schema/index.ts",
  // Where the API reads them: `postgres-module.ts` applies this folder on its first request.
  out: "./migrations",
  dialect: "postgresql",
  // `generate` reads no database; the URL is for the drizzle-kit commands that do (`push`, `studio`).
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
});
