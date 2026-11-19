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
 * starts a database of its own, about 150 MB and 0.7 s: `await db.$client.end()` closes the connection and
 * also stops the server and the database, so call it in an `afterEach` or `afterAll`.
 */
export async function createTestDb(): Promise<ReturnType<typeof drizzle<typeof barrel>>>;
export async function createTestDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
): Promise<ReturnType<typeof drizzle<TSchema>>>;
export async function createTestDb(schema: Record<string, unknown> = barrel) {
  const { url, stop } = await startTestPostgres();
  const sql = postgres(url, { max: 1 });
  const end = sql.end.bind(sql);
  sql.end = async (options) => {
    await end(options);
    await stop();
  };
  try {
    for (const statement of await createStatements(schema)) {
      await sql.unsafe(statement);
    }
  } catch (error) {
    await sql.end();
    throw error;
  }
  return drizzle(sql, { schema });
}

/** The database `createTestDb()` returns for the barrel. */
export type TestDb = ReturnType<typeof drizzle<typeof barrel>>;
