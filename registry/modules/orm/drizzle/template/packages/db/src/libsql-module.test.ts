import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import { Elysia } from "elysia";
import { afterAll, describe, expect, it } from "vite-plus/test";
import { readLibsql } from "./libsql";
import { dbPlugin } from "./libsql-module";

const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  body: text("body").notNull(),
});

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "libsql-module-"));
  dirs.push(dir);
  return dir;
}

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

/** What `db:generate` writes for a first migration: the journal and the SQL of the `notes` table. */
async function writeMigration(folder: string): Promise<void> {
  const statements = await generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson({ notes }),
  );
  await mkdir(join(folder, "meta"), { recursive: true });
  await writeFile(join(folder, "0000_notes.sql"), statements.join("--> statement-breakpoint\n"));
  const journal = {
    version: "7",
    dialect: "sqlite",
    entries: [
      { idx: 0, version: "6", when: 1_700_000_000_000, tag: "0000_notes", breakpoints: true },
    ],
  };
  await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
}

/** An app over a database file of its own: the plugin, a probe of the tables, and `/health`. */
async function appOver(dataDir: string, migrationsFolder: string) {
  const source = { DATA_DIR: dataDir, NODE_ENV: "test" };
  const app = new Elysia()
    .use(dbPlugin(() => readLibsql(source), migrationsFolder))
    .get("/health", () => "ok")
    .get("/tables", ({ db }) =>
      db.all<{ name: string }>(
        sql`SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
      ),
    );
  const client = await readLibsql(source);
  return { app, client };
}

const get = (app: { handle: (request: Request) => Promise<Response> }, path: string) =>
  app.handle(new Request(`http://localhost${path}`));

describe("dbPlugin", () => {
  it("applies the migrations on the first request: the table exists, and db is on the context", async () => {
    const migrations = await tempDir();
    await writeMigration(migrations);
    const { app } = await appOver(await tempDir(), migrations);

    const response = await get(app, "/tables");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ name: "__drizzle_migrations" }, { name: "notes" }]);
  });

  it("does not apply them again when a plugin starts over a migrated file", async () => {
    const migrations = await tempDir();
    await writeMigration(migrations);
    const dataDir = await tempDir();
    const first = await appOver(dataDir, migrations);
    await get(first.app, "/tables");

    // A second start: `CREATE TABLE notes` would fail if the migration ran again.
    const second = await appOver(dataDir, migrations);
    const response = await get(second.app, "/tables");

    expect(response.status).toBe(200);
    const applied = await first.client.execute("SELECT count(*) AS n FROM __drizzle_migrations");
    expect(applied.rows[0]?.n).toBe(1);
  });

  it("runs the migrations once for two first requests at the same time", async () => {
    const migrations = await tempDir();
    await writeMigration(migrations);
    const { app, client } = await appOver(await tempDir(), migrations);

    const responses = await Promise.all([get(app, "/tables"), get(app, "/tables")]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    const applied = await client.execute("SELECT count(*) AS n FROM __drizzle_migrations");
    expect(applied.rows[0]?.n).toBe(1);
  });

  it("starts and answers /health when the folder has no journal", async () => {
    const empty = await tempDir();
    const { app } = await appOver(await tempDir(), empty);

    const health = await get(app, "/health");
    const tables = await get(app, "/tables");

    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    expect(await tables.json()).toEqual([]);
  });
});
