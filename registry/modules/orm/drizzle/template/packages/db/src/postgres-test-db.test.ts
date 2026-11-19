import { connect } from "node:net";
import { count, eq, getTableName, is, sql } from "drizzle-orm";
import { PgTable, integer, pgTable, serial, text } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it } from "vite-plus/test";
import * as barrel from "./schema";
import { createTestDb } from "./postgres-test-db";

const open: { $client: { end: () => Promise<void> } }[] = [];
/** `createTestDb`, with the database closed after the test: each one holds a Postgres of its own. */
async function testDb<T extends Record<string, unknown>>(schema?: T) {
  const db = schema ? await createTestDb(schema) : await createTestDb();
  open.push(db);
  return db;
}

afterEach(async () => {
  await Promise.all(open.splice(0).map((db) => db.$client.end()));
});

/** Whether something still listens where `db` is connected. */
function listening(db: Awaited<ReturnType<typeof createTestDb>>): Promise<boolean> {
  const { host, port } = db.$client.options;
  return new Promise((resolve) => {
    const socket = connect({ host: host[0] ?? "127.0.0.1", port: port[0] ?? 0 });
    socket.once("connect", () => resolve(true));
    socket.once("error", () => resolve(false));
    socket.once("connect", () => socket.destroy());
  });
}

const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  body: text("body").notNull(),
});

describe("createTestDb", () => {
  it("creates the tables of the schema it is given, in a real Postgres", async () => {
    const db = await testDb({ notes });

    await db.insert(notes).values({ body: "first" });
    const rows = await db.select().from(notes).where(eq(notes.body, "first"));

    expect(rows).toEqual([{ id: 1, body: "first" }]);
  });

  it("gives each call a database of its own", async () => {
    const first = await testDb({ notes });
    const second = await testDb({ notes });

    await first.insert(notes).values({ body: "only in the first" });

    expect(await second.select().from(notes)).toEqual([]);
  });

  it("creates the tables of the project's schema barrel when it is given none", async () => {
    const db = await testDb();

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
    const db = await testDb({ owners, pets });

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

  it("stops its server and database when the client ends", async () => {
    const db = await createTestDb({ notes });
    expect(await listening(db)).toBe(true);

    await db.$client.end();

    expect(await listening(db)).toBe(false);
  });
});
