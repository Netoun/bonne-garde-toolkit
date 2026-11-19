import { drizzle } from "drizzle-orm/postgres-js";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { Sql } from "postgres";
import * as schema from "./schema";

export type DB = PostgresJsDatabase<typeof schema>;

/** The Drizzle client over a postgres-js client, with every table of the schema barrel. */
export function createDB(sql: Sql): DB {
  return drizzle(sql, { schema, logger: false });
}
