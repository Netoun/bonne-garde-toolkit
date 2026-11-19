import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vite-plus/test";
import { createDB } from "./libsql-client";

describe("createDB", () => {
  it("runs Drizzle's libsql driver against a real libsql database", async () => {
    const db = createDB(createClient({ url: ":memory:" }));

    await db.run(sql`CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT NOT NULL)`);
    await db.run(sql`INSERT INTO notes (body) VALUES (${"first"})`);
    const rows = await db.all<{ body: string }>(sql`SELECT body FROM notes`);

    expect(rows).toEqual([{ body: "first" }]);
  });
});
