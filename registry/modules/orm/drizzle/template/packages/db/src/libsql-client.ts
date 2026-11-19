import type { Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import type { LibSQLDatabase } from "drizzle-orm/libsql";
import * as schema from "./schema";

export type DB = LibSQLDatabase<typeof schema>;

/** The Drizzle client over a libsql client, with every table of the schema barrel. */
export function createDB(client: Client): DB {
  return drizzle(client, { schema, logger: false });
}
