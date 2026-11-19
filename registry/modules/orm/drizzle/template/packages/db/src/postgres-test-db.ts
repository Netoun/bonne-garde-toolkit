import { drizzle } from "drizzle-orm/postgres-js";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import postgres from "postgres";
import * as barrel from "./schema";
import { startTestPostgres } from "./postgres-testing";

/** The SQL that creates every table of `schema`, from nothing: what `db:generate` writes for a first migration. */
async function createStatements(schema: Record<string, unknown>): Promise<string[]> {
  return generateMigration(generateDrizzleJson({}), generateDrizzleJson(schema));
}

/**
 * A fresh in-memory Postgres (PGlite, served over a socket) with the tables of the project's schema barrel,
 * or of `schema` when a test brings its own, behind the postgres-js driver the API uses. The tables come
 * from the schema and not from the migrations, so a test does not wait for `vp run db:generate`. Each call
 * starts a database of its own; the one connection and the server it holds end with the test process.
 */
export async function createTestDb(): Promise<ReturnType<typeof drizzle<typeof barrel>>>;
export async function createTestDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
): Promise<ReturnType<typeof drizzle<TSchema>>>;
export async function createTestDb(schema: Record<string, unknown> = barrel) {
  const { url } = await startTestPostgres();
  const sql = postgres(url, { max: 1 });
  for (const statement of await createStatements(schema)) {
    await sql.unsafe(statement);
  }
  return drizzle(sql, { schema });
}

/** The database `createTestDb()` returns for the barrel. */
export type TestDb = ReturnType<typeof drizzle<typeof barrel>>;
