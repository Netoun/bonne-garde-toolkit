import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Client } from "@libsql/client";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDB } from "{{SCOPE}}/db";
import { readLibsql } from "{{SCOPE}}/db/libsql";
import { hashPassword } from "./password";

export const ADMIN_EMAIL = "admin@example.local";
export const ADMIN_PASSWORD = "password123";

/** `packages/db/migrations`, where `db:generate` writes them: found from this file, not the cwd. */
const MIGRATIONS_FOLDER = join(import.meta.dirname, "../../db/migrations");

function quote(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The SQL that gives a database an admin who can sign in: a verified user, the credential account
 * that holds the password, and a Personal organization the admin owns, which is what the sign-up
 * hook gives everyone. The hash is `hashPassword`'s, the one Better Auth verifies with.
 */
export async function seedStatements(now = Date.now()): Promise<string[]> {
  const adminId = crypto.randomUUID();
  const organizationId = crypto.randomUUID();
  const password = await hashPassword(ADMIN_PASSWORD);

  return [
    `INSERT INTO "user" ("id", "name", "email", "email_verified", "image", "created_at", "updated_at") VALUES (${quote(adminId)}, 'Admin', ${quote(ADMIN_EMAIL)}, 1, NULL, ${now}, ${now});`,
    `INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at") VALUES (${quote(crypto.randomUUID())}, ${quote(adminId)}, 'credential', ${quote(adminId)}, ${quote(password)}, ${now}, ${now});`,
    `INSERT INTO "organization" ("id", "name", "slug", "logo", "created_at", "metadata", "settings") VALUES (${quote(organizationId)}, 'Personal', 'personal', NULL, ${now}, NULL, '{}');`,
    `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES (${quote(crypto.randomUUID())}, ${quote(organizationId)}, ${quote(adminId)}, 'owner', ${now});`,
  ];
}

/** What `seedAdmin` needs of a database: a read, and statements that are applied together or not at all. */
export type SeedDatabase = {
  rows(statement: string): Promise<Record<string, unknown>[]>;
  batch(statements: string[]): Promise<void>;
};

/** A libsql client as a `SeedDatabase`: its batch is one write transaction. */
export function libsqlSeedDatabase(client: Client): SeedDatabase {
  return {
    rows: async (statement) => {
      const { columns, rows } = await client.execute(statement);
      return rows.map((row) =>
        Object.fromEntries(columns.map((name, index) => [name, row[index]])),
      );
    },
    batch: async (statements) => {
      await client.batch(statements, "write");
    },
  };
}

/**
 * Gives the database its admin, unless it has one: an admin is the user with `ADMIN_EMAIL`, whatever else
 * that user holds, so a database that has one is left exactly as it is. The inserts are one batch, so a
 * seed either adds the whole admin or nothing; the unique `user.email` still refuses a second admin
 * should two seeds start at once.
 */
export async function seedAdmin(
  database: SeedDatabase,
  now = Date.now(),
): Promise<"seeded" | "present"> {
  const admins = await database.rows(
    `SELECT "id" FROM "user" WHERE "email" = ${quote(ADMIN_EMAIL)} LIMIT 1`,
  );
  if (admins.length > 0) {
    return "present";
  }
  await database.batch(await seedStatements(now));
  return "seeded";
}

/**
 * Applies the migrations `db:generate` wrote to the database behind `client`, then gives it its admin.
 * Without a journal there are no tables to seed: it says to run `db:generate` instead of failing on a
 * missing table.
 */
export async function seedLibsql(
  client: Client,
  migrationsFolder = MIGRATIONS_FOLDER,
): Promise<"seeded" | "present"> {
  if (!existsSync(join(migrationsFolder, "meta", "_journal.json"))) {
    throw new Error(
      `No migrations in ${migrationsFolder}: run \`vp run db:generate\` in packages/db first.`,
    );
  }
  await migrate(createDB(client), { migrationsFolder });
  return seedAdmin(libsqlSeedDatabase(client));
}

/**
 * `vp run db:seed`: applies the migrations to `<DATA_DIR>/db.sqlite`, then inserts the admin. It deletes
 * nothing: on a database that already has the admin it says so and exits 0. Starting over is deleting the
 * database file.
 */
async function main(): Promise<void> {
  const message =
    (await seedLibsql(await readLibsql())) === "seeded"
      ? `Seeded: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}, owner of the Personal organization\n`
      : `Already seeded: ${ADMIN_EMAIL} exists, so nothing was changed\n`;
  process.stdout.write(message);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
