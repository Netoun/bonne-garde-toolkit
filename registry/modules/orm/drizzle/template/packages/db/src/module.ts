import { Elysia } from "elysia";
import { readD1 } from "./d1";
import { createDB } from "./client";

/** The Elysia plugin that puts `db` on the context of every route registered after it. */
export function dbPlugin(readDatabase: typeof readD1) {
  return new Elysia({ name: "db.module" }).derive({ as: "global" }, async () => ({
    db: createDB(await readDatabase()),
  }));
}

export const dbModule = dbPlugin(readD1);
