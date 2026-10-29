import { defineConfig } from "drizzle-kit";

export default defineConfig({
  // `*-schema.ts` only: keeps any `*.test.ts` placed next to the schemas out of the glob,
  // otherwise drizzle-kit tries to load `bun:test` and `db:generate` fails.
  schema: "./src/modules/db/schemas/*-schema.ts",
  out: "./src/modules/db/migrations",
  dialect: "sqlite",
});
