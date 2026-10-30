import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { sql } from "drizzle-orm";
import { Miniflare } from "miniflare";
import { createDB } from "./client";

const miniflare = new Miniflare({
  modules: true,
  script: "export default {}",
  d1Databases: { DB: "client-test" },
});
let d1: Awaited<ReturnType<Miniflare["getD1Database"]>>;

beforeAll(async () => {
  d1 = await miniflare.getD1Database("DB");
});

afterAll(async () => {
  await miniflare.dispose();
});

describe("createDB", () => {
  it("runs Drizzle's D1 driver against a real D1", async () => {
    const db = createDB(d1);

    await db.run(sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`);
    await db.run(sql`INSERT INTO notes (body) VALUES (${"first"})`);
    const rows = await db.all<{ body: string }>(sql`SELECT body FROM notes`);

    expect(rows).toEqual([{ body: "first" }]);
  });
});
