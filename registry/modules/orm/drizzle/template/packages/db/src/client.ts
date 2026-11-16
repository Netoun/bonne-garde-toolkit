/// <reference types="@cloudflare/workers-types" />
import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as schema from "./schema";

export type DB = DrizzleD1Database<typeof schema>;

/** The Drizzle client over a D1 database, with every table of the schema barrel. */
export function createDB(d1: D1Database): DB {
  return drizzle(d1, { schema, logger: false });
}
