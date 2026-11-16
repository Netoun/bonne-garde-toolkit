import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import * as barrel from "./schema";

/** The SQL that creates every table of `schema`, from nothing: what `db:generate` writes for a first migration. */
async function createStatements(schema: Record<string, unknown>): Promise<string[]> {
  return generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema),
  );
}

/**
 * A fresh in-memory SQLite database, which is what D1 is, with the tables of the project's schema
 * barrel, or of `schema` when a test brings its own. The tables come from the schema and not from
 * the migrations, so a test does not wait for `bun run db:generate`.
 */
export async function createTestDb(): Promise<ReturnType<typeof drizzle<typeof barrel>>>;
export async function createTestDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
): Promise<ReturnType<typeof drizzle<TSchema>>>;
export async function createTestDb(schema: Record<string, unknown> = barrel) {
  const sqlite = new Database(":memory:");
  for (const statement of await createStatements(schema)) {
    sqlite.exec(statement);
  }
  return drizzle(sqlite, { schema });
}

/** The database `createTestDb()` returns for the barrel, with a `query` of its tables. */
export type TestDb = ReturnType<typeof drizzle<typeof barrel>>;
