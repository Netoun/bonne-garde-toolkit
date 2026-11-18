import { afterAll, describe, expect, it } from "vite-plus/test";
import { count, eq, getTableName, is, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/d1";
import { integer, SQLiteTable, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { Miniflare } from "miniflare";
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

const owners = sqliteTable("owners", {
  id: integer("id").primaryKey(),
  name: text("name").notNull(),
  verified: integer("verified", { mode: "boolean" }).notNull(),
});
const pets = sqliteTable("pets", {
  id: integer("id").primaryKey(),
  ownerId: integer("owner_id")
    .notNull()
    .references(() => owners.id),
});
const pair = { owners, pets };

/** What a test does to a database through Drizzle, and what came back of each step. */
async function exercise(db: Awaited<ReturnType<typeof createTestDb<typeof pair>>>) {
  const inserted = await db
    .insert(owners)
    .values({ id: 1, name: "Ada", verified: true })
    .returning();
  const raw = await db.all(sql`SELECT id, name, verified FROM owners`);
  const typed = await db.select().from(owners).where(eq(owners.name, "Ada"));
  const one = await db.select({ name: owners.name }).from(owners).get();
  const orphan = await db
    .insert(pets)
    .values({ id: 1, ownerId: 99 })
    .then(
      () => "inserted",
      () => "refused",
    );
  const batch = await db
    .batch([
      db.insert(owners).values({ id: 2, name: "Grace", verified: false }),
      db.insert(pets).values({ id: 2, ownerId: 99 }),
    ])
    .then(
      () => "applied",
      () => "refused",
    );
  const [{ owners: left } = { owners: -1 }] = await db.select({ owners: count() }).from(owners);
  return { inserted, raw, typed, one, orphan, batch, left };
}

// D1 is what the project runs on, and Miniflare runs workerd's own: the test database has to answer
// each of these as it does, or a test that passes on it says nothing about the API.
describe("createTestDb answers as D1 does", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: "parity-test" },
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  it("for a raw read, a typed one, returning, get, a foreign key and a failed batch", async () => {
    const d1 = await miniflare.getD1Database("DB");
    await d1.batch(
      [
        `CREATE TABLE "owners" ("id" integer PRIMARY KEY NOT NULL, "name" text NOT NULL, "verified" integer NOT NULL)`,
        `CREATE TABLE "pets" ("id" integer PRIMARY KEY NOT NULL, "owner_id" integer NOT NULL REFERENCES "owners"("id"))`,
      ].map((statement) => d1.prepare(statement)),
    );

    const local = await exercise(await createTestDb(pair));
    const real = await exercise(drizzle(d1, { schema: pair }));

    expect(local).toEqual(real);
    expect(real).toMatchObject({ orphan: "refused", batch: "refused", left: 1 });
  });
});
