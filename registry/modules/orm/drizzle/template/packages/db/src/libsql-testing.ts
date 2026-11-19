import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
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
 * A fresh in-memory libsql database with the tables of the project's schema barrel, or of `schema` when
 * a test brings its own, behind the Drizzle driver the API uses. The tables come from the schema and not
 * from the migrations, so a test does not wait for `vp run db:generate`.
 */
export async function createTestDb(): Promise<ReturnType<typeof drizzle<typeof barrel>>>;
export async function createTestDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
): Promise<ReturnType<typeof drizzle<TSchema>>>;
export async function createTestDb(schema: Record<string, unknown> = barrel) {
  const client = createClient({ url: ":memory:" });
  for (const statement of await createStatements(schema)) {
    await client.execute(statement);
  }
  return drizzle(client, { schema });
}

/** The database `createTestDb()` returns for the barrel. */
export type TestDb = ReturnType<typeof drizzle<typeof barrel>>;
