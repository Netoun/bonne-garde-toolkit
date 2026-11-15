import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { getTableName, is, sql } from "drizzle-orm";
import {
  integer,
  SQLiteTable,
  sqliteTable,
  text,
  type AnySQLiteColumn,
} from "drizzle-orm/sqlite-core";
import { Miniflare } from "miniflare";
import * as barrel from "./schema";
import { resetOrder, resetStatements } from "./reset";
import { createTestDb } from "./testing";

// Tables shaped like a module's: `uploads.owner_id` has no cascade, as `medias.author_id` has none, so a
// parent cannot be deleted while an upload still points at it. `categories` points at itself.
const users = sqliteTable("users", { id: text("id").primaryKey() });
const organizations = sqliteTable("organizations", { id: text("id").primaryKey() });
const uploads = sqliteTable("uploads", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").references(() => users.id),
  organizationId: text("organization_id").references(() => organizations.id, {
    onDelete: "cascade",
  }),
});
const attachments = sqliteTable("attachments", {
  id: text("id").primaryKey(),
  uploadId: text("upload_id")
    .notNull()
    .references(() => uploads.id),
});
const categories = sqliteTable("categories", {
  id: integer("id").primaryKey(),
  parentId: integer("parent_id").references((): AnySQLiteColumn => categories.id),
});
const schema = { users, organizations, uploads, attachments, categories };

describe("resetOrder", () => {
  it("puts every table before the tables it points at", () => {
    const order = resetOrder(schema);

    expect(order.sort()).toEqual(Object.values(schema).map(getTableName).sort());
    const position = (table: SQLiteTable) => resetOrder(schema).indexOf(getTableName(table));
    expect(position(attachments)).toBeLessThan(position(uploads));
    expect(position(uploads)).toBeLessThan(position(users));
    expect(position(uploads)).toBeLessThan(position(organizations));
  });

  it("does not depend on the order the schema lists its tables in", () => {
    const reversed = Object.fromEntries(Object.entries(schema).reverse());

    expect(resetOrder(reversed)).toEqual(resetOrder(schema));
  });

  it("leaves out what is not a table, and a reference to a table the schema does not hold", () => {
    const order = resetOrder({ uploads, notATable: { name: "users" }, helper: () => users });

    expect(order).toEqual(["uploads"]);
  });

  it("refuses a cycle between tables, naming them: no order of deletes empties them", () => {
    const first = sqliteTable("first", {
      id: integer("id").primaryKey(),
      secondId: integer("second_id").references((): AnySQLiteColumn => second.id),
    });
    const second = sqliteTable("second", {
      id: integer("id").primaryKey(),
      firstId: integer("first_id").references((): AnySQLiteColumn => first.id),
    });

    expect(() => resetOrder({ first, second })).toThrow(/first, second/);
  });
});

describe("resetStatements", () => {
  it("is one DELETE per table of the schema, in that order, and nothing else", () => {
    expect(resetStatements(schema)).toEqual(
      resetOrder(schema).map((name) => `DELETE FROM "${name}";`),
    );
  });

  it("covers the tables of the schema barrel and no other, by default", () => {
    const tables = Object.values(barrel)
      .filter((value) => is(value, SQLiteTable))
      .map(getTableName);

    expect(resetStatements().sort()).toEqual(tables.map((name) => `DELETE FROM "${name}";`).sort());
  });

  it("empties real SQLite with foreign keys enforced, where a parent's rows are still pointed at", async () => {
    const db = await createTestDb(schema);
    await db.run(sql`PRAGMA foreign_keys = ON`);
    await db.insert(users).values({ id: "u1" });
    await db.insert(organizations).values({ id: "o1" });
    await db.insert(uploads).values({ id: "m1", ownerId: "u1", organizationId: "o1" });
    await db.insert(attachments).values({ id: "a1", uploadId: "m1" });
    await db.insert(categories).values([
      { id: 1, parentId: null },
      { id: 2, parentId: 1 },
    ]);
    // Without the order it would not: this is the failure `auth`'s own reset had once a `medias` row existed.
    expect(() => db.run(sql`DELETE FROM "users"`)).toThrow(/Failed to run the query/);
    expect(await db.select().from(users)).toEqual([{ id: "u1" }]);

    for (const statement of resetStatements(schema)) {
      await db.run(sql.raw(statement));
    }

    for (const table of Object.values(schema)) {
      expect(await db.select().from(table)).toEqual([]);
    }
  });
});

// D1 is the database the statements run on. Miniflare runs workerd's own, which enforces foreign keys the
// way Cloudflare's does, so what these tests show about the order holds for `wrangler d1 execute`.
describe("resetStatements on a real D1", () => {
  const miniflare = new Miniflare({
    modules: true,
    script: "export default {}",
    d1Databases: { DB: "reset-test" },
  });
  let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;

  beforeAll(async () => {
    d1 = await miniflare.getD1Database("DB");
    await d1.batch(
      [
        `CREATE TABLE "users" ("id" text PRIMARY KEY NOT NULL)`,
        `CREATE TABLE "organizations" ("id" text PRIMARY KEY NOT NULL)`,
        `CREATE TABLE "uploads" ("id" text PRIMARY KEY NOT NULL, "owner_id" text REFERENCES "users"("id"), "organization_id" text REFERENCES "organizations"("id") ON DELETE CASCADE)`,
        `CREATE TABLE "attachments" ("id" text PRIMARY KEY NOT NULL, "upload_id" text NOT NULL REFERENCES "uploads"("id"))`,
        `CREATE TABLE "categories" ("id" integer PRIMARY KEY NOT NULL, "parent_id" integer REFERENCES "categories"("id"))`,
        `INSERT INTO "users" ("id") VALUES ('u1')`,
        `INSERT INTO "organizations" ("id") VALUES ('o1')`,
        `INSERT INTO "uploads" ("id", "owner_id", "organization_id") VALUES ('m1', 'u1', 'o1')`,
        `INSERT INTO "attachments" ("id", "upload_id") VALUES ('a1', 'm1')`,
        `INSERT INTO "categories" ("id", "parent_id") VALUES (1, NULL), (2, 1)`,
      ].map((statement) => d1.prepare(statement)),
    );
  });

  afterAll(async () => {
    await miniflare.dispose();
  });

  const count = async (table: string) =>
    (await d1.prepare(`SELECT count(*) AS n FROM "${table}"`).first<{ n: number }>())?.n;

  it("refuses to delete a parent first, which is what makes the order matter", async () => {
    await expect(d1.prepare(`DELETE FROM "users"`).run()).rejects.toThrow(/FOREIGN KEY/);
    expect(await count("users")).toBe(1);
  });

  it("empties every table in one batch, the order a foreign key accepts", async () => {
    await d1.batch(resetStatements(schema).map((statement) => d1.prepare(statement)));

    for (const table of Object.values(schema).map(getTableName)) {
      expect([table, await count(table)]).toEqual([table, 0]);
    }
  });
});
