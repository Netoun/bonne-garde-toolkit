import { count, eq, getTableName, is, sql } from "drizzle-orm";
import { integer, SQLiteTable, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { createClient } from "@libsql/client";
import { describe, expect, it } from "vite-plus/test";
import * as barrel from "./schema";
import { createTestDb } from "./libsql-testing";

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

  it("creates the tables on the client it is given, and the rows stay on it", async () => {
    const client = createClient({ url: ":memory:" });

    const db = await createTestDb({ notes }, client);
    await db.insert(notes).values({ body: "kept" });

    const result = await client.execute("select body from notes");
    expect(result.rows[0]?.body).toBe("kept");
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

  it("enforces foreign keys and keeps its tables inside a transaction", async () => {
    const owners = sqliteTable("owners", { id: integer("id").primaryKey() });
    const pets = sqliteTable("pets", {
      id: integer("id").primaryKey(),
      ownerId: integer("owner_id")
        .notNull()
        .references(() => owners.id),
    });
    const db = await createTestDb({ owners, pets });

    const orphan = await db
      .insert(pets)
      .values({ id: 1, ownerId: 99 })
      .then(
        () => "inserted",
        () => "refused",
      );
    await db.transaction(async (tx) => {
      await tx.insert(owners).values({ id: 1 });
    });
    const [{ owners: left } = { owners: -1 }] = await db.select({ owners: count() }).from(owners);

    expect(orphan).toBe("refused");
    expect(left).toBe(1);
  });
});
