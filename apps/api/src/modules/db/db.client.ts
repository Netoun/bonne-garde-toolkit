import { drizzle } from "drizzle-orm/d1";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import * as authSchema from "./schemas/db.auth-schema";
import { coreSchema } from "./schemas/db.core-schema";

const schema = { ...authSchema, ...coreSchema };

export type DB = DrizzleD1Database<typeof schema>;

export function createDB(db: D1Database): DB {
  return drizzle(db, { schema, logger: false });
}
