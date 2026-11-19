import postgres from "postgres";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { startTestPostgres } from "./postgres-testing";
import { createDB } from "./postgres-client";

let server: Awaited<ReturnType<typeof startTestPostgres>>;
let client: ReturnType<typeof postgres>;

beforeAll(async () => {
  server = await startTestPostgres();
  client = postgres(server.url, { max: 1 });
});

afterAll(async () => {
  await client.end({ timeout: 1 });
  await server.stop();
});

describe("createDB", () => {
  it("runs Drizzle's postgres-js driver against a real Postgres", async () => {
    const db = createDB(client);

    await db.execute(sql`CREATE TABLE notes (id serial PRIMARY KEY, body text NOT NULL)`);
    await db.execute(sql`INSERT INTO notes (body) VALUES (${"first"})`);
    const rows = await db.execute<{ body: string }>(sql`SELECT body FROM notes`);

    expect([...rows]).toEqual([{ body: "first" }]);
  });
});
