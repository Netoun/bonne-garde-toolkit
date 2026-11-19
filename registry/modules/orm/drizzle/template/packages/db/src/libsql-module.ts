import { existsSync } from "node:fs";
import { join } from "node:path";
import { Elysia } from "elysia";
import { migrate } from "drizzle-orm/libsql/migrator";
import { readLibsql } from "./libsql";
import { createDB, type DB } from "./libsql-client";

// `db:generate` writes the migrations next to `src`; the folder is found from this file, not the cwd.
const MIGRATIONS_FOLDER = join(import.meta.dirname, "../migrations");

/**
 * The database with its migrations applied. A folder `db:generate` has not written yet has no journal,
 * and there is nothing to apply: the API still starts.
 */
async function openMigrated(
  readDatabase: typeof readLibsql,
  migrationsFolder: string,
): Promise<DB> {
  const db = createDB(await readDatabase());
  if (existsSync(join(migrationsFolder, "meta", "_journal.json"))) {
    await migrate(db, { migrationsFolder });
  }
  return db;
}

/**
 * The Elysia plugin that puts `db` on the context of every route registered after it. The first request
 * opens the database and applies the migrations; the promise is kept, so two first requests at the same
 * time run them once, and a failure is not kept, so the next request tries again.
 */
export function dbPlugin(readDatabase: typeof readLibsql, migrationsFolder = MIGRATIONS_FOLDER) {
  let ready: Promise<DB> | undefined;
  return new Elysia({ name: "db.module" }).derive({ as: "global" }, async () => {
    ready ??= openMigrated(readDatabase, migrationsFolder).catch((error: unknown) => {
      ready = undefined;
      throw error;
    });
    return { db: await ready };
  });
}

export const dbModule = dbPlugin(readLibsql);
