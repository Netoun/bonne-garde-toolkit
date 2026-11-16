import { describe, expect, it } from "bun:test";
import { eq, getTableName, is, sql } from "drizzle-orm";
import { integer, SQLiteTable, sqliteTable, text } from "drizzle-orm/sqlite-core";
import * as barrel from "./schema";
import { createTestDb } from "./testing";

const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
});

describe("createTestDb", () => {
  it("creates the tables of the schema it is given, in a real SQLite", async () => {
    const db = await createTestDb({ notes });

    await db.insert(notes).values({ body: "first" });
    const rows = await db.select().from(notes).where(eq(notes.body, "first"));

    expect(rows).toEqual([{ id: 1, body: "first" }]);
  });

  it("gives each call a database of its own", async () => {
    const first = await createTestDb({ notes });
    const second = await createTestDb({ notes });

    await first.insert(notes).values({ body: "only in the first" });

    expect(await second.select().from(notes)).toEqual([]);
  });

  it("creates the tables of the project's schema barrel when it is given none", async () => {
    const db = await createTestDb();

    const tables = await db.all<{ name: string }>(
      sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
    );

    const barrelTables = Object.values(barrel)
      .filter((value) => is(value, SQLiteTable))
      .map((table) => getTableName(table));
    expect(tables.map(({ name }) => name).sort()).toEqual(barrelTables.sort());
  });
});
