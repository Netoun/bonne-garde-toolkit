import { count, eq, getTableName, is, sql } from "drizzle-orm";
import { PgTable, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { describe, expect, it } from "vite-plus/test";
import * as barrel from "./schema";
import { createTestDb } from "./postgres-test-db";

const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  body: text("body").notNull(),
});

describe("createTestDb", () => {
  it("creates the tables of the schema it is given, in a real Postgres", async () => {
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

    const tables = await db.execute<{ name: string }>(
      sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public'`,
    );

    const barrelTables = Object.values(barrel)
      .filter((value) => is(value, PgTable))
      .map((table) => getTableName(table));
    expect(Array.from(tables, ({ name }) => name).sort()).toEqual(barrelTables.sort());
  });

  it("enforces foreign keys and keeps its tables inside a transaction", async () => {
    const owners = pgTable("owners", { id: integer("id").primaryKey() });
    const pets = pgTable("pets", {
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
