import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sql } from "drizzle-orm";
import { pgTable, serial, text } from "drizzle-orm/pg-core";
import { generateDrizzleJson, generateMigration } from "drizzle-kit/api";
import { Elysia } from "elysia";
import postgres from "postgres";
import { afterEach, describe, expect, it } from "vite-plus/test";
import { readPostgres } from "./postgres";
import { dbPlugin } from "./postgres-module";
import { startTestPostgres } from "./postgres-testing";

const notes = pgTable("notes", {
  id: serial("id").primaryKey(),
  body: text("body").notNull(),
});

const dirs: string[] = [];
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "postgres-module-"));
  dirs.push(dir);
  return dir;
}

const stops: (() => Promise<void>)[] = [];
/** A real Postgres of its own, and the one connection PGlite serves. */
async function serve() {
  const server = await startTestPostgres();
  const client = postgres(server.url, { max: 1 });
  stops.push(async () => {
    await client.end({ timeout: 1 });
    await server.stop();
  });
  return client;
}

afterEach(async () => {
  await Promise.all(stops.splice(0).map((stop) => stop()));
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

/** What `db:generate` writes for a first migration: the journal and the SQL of the `notes` table. */
async function writeMigration(folder: string): Promise<void> {
  const statements = await generateMigration(
    generateDrizzleJson({}),
    generateDrizzleJson({ notes }),
  );
  await mkdir(join(folder, "meta"), { recursive: true });
  await writeFile(join(folder, "0000_notes.sql"), statements.join("--> statement-breakpoint\n"));
  const journal = {
    version: "7",
    dialect: "postgresql",
    entries: [
      { idx: 0, version: "7", when: 1_700_000_000_000, tag: "0000_notes", breakpoints: true },
    ],
  };
  await writeFile(join(folder, "meta", "_journal.json"), JSON.stringify(journal));
}

/** An app over the database `client` holds: the plugin, a probe of the tables, and `/health`. */
function appOver(client: postgres.Sql, migrationsFolder: string) {
  return new Elysia()
    .use(dbPlugin(async () => client, migrationsFolder))
    .get("/health", () => "ok")
    .get("/tables", async ({ db }) => {
      const rows = await db.execute<{ name: string }>(
        sql`SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1`,
      );
      return Array.from(rows, ({ name }) => name);
    });
}

const get = (app: { handle: (request: Request) => Promise<Response> }, path: string) =>
  app.handle(new Request(`http://localhost${path}`));

const applied = async (client: postgres.Sql) =>
  (await client`SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations`)[0]?.n;

describe("dbPlugin", () => {
  it("applies the migrations on the first request: the table exists, and db is on the context", async () => {
    const migrations = await tempDir();
    await writeMigration(migrations);
    const app = appOver(await serve(), migrations);

    const response = await get(app, "/tables");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual(["notes"]);
  });

  it("does not apply them again when a plugin starts over a migrated database", async () => {
    const migrations = await tempDir();
    await writeMigration(migrations);
    const client = await serve();
    await get(appOver(client, migrations), "/tables");

    // A second start: `CREATE TABLE notes` would fail if the migration ran again.
    const response = await get(appOver(client, migrations), "/tables");

    expect(response.status).toBe(200);
    expect(await applied(client)).toBe(1);
  });

  it("runs the migrations once for two first requests at the same time", async () => {
    const migrations = await tempDir();
    await writeMigration(migrations);
    const client = await serve();
    const app = appOver(client, migrations);

    const responses = await Promise.all([get(app, "/tables"), get(app, "/tables")]);

    expect(responses.map(({ status }) => status)).toEqual([200, 200]);
    expect(await applied(client)).toBe(1);
  });

  it("starts and answers /health when the folder has no journal", async () => {
    const app = appOver(await serve(), await tempDir());

    const health = await get(app, "/health");
    const tables = await get(app, "/tables");

    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    expect(await tables.json()).toEqual([]);
  });

  it("starts and answers /health with no DATABASE_URL, and a route that queries fails naming it", async () => {
    const migrations = await tempDir();
    await writeMigration(migrations);
    const app = new Elysia()
      .use(dbPlugin(() => readPostgres({ NODE_ENV: "test" }), migrations))
      .get("/health", () => "ok")
      .get("/query", async ({ db, status }) => {
        try {
          await db.execute(sql`SELECT 1`);
          return "ok";
        } catch (error) {
          // Drizzle wraps the driver's error: the message that names the variable is down the cause chain.
          const messages: string[] = [];
          for (let next: unknown = error; next instanceof Error; next = next.cause) {
            messages.push(next.message);
          }
          return status(500, messages.join(" <- "));
        }
      });

    const health = await get(app, "/health");
    const query = await get(app, "/query");

    expect(health.status).toBe(200);
    expect(await health.text()).toBe("ok");
    expect(query.status).toBe(500);
    expect(await query.text()).toContain("DATABASE_URL");
  });
});
