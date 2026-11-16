import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // The barrel, not a glob: a test or a helper next to a schema file is never loaded by drizzle-kit.
  schema: "./src/schema/index.ts",
  // Where `wrangler d1 migrations apply` reads them: `migrations_dir` of the D1 binding.
  out: "./migrations",
  dialect: "sqlite",
});
