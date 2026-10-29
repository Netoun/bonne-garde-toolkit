import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as authSchema from "../../src/modules/db/schemas/db.auth-schema";
import * as coreSchema from "../../src/modules/db/schemas/db.core-schema";

const schema = { ...authSchema, ...coreSchema };

export function createTestDb() {
  const sqlite = new Database(":memory:");
  const db = drizzle(sqlite, { schema });

  const migrationsDir = new URL("../../src/modules/db/migrations", import.meta.url).pathname;
  migrate(db, { migrationsFolder: migrationsDir });

  return db;
}

export type TestDb = ReturnType<typeof createTestDb>;
