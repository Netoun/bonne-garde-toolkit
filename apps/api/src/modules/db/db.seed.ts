import { hashPassword } from "@acme/api/lib/crypto/password";

const ADMIN_EMAIL = "admin@example.local";
const ADMIN_PASSWORD = "password123";

function esc(value: string | null): string {
  if (value === null) return "NULL";
  return "'" + value.replace(/'/g, "''") + "'";
}

async function main() {
  console.log("Cleaning D1 database...");
  const cleanProc = Bun.spawn([
    "bunx",
    "wrangler",
    "d1",
    "execute",
    "my-app-db",
    "--local",
    "--command=DELETE FROM member; DELETE FROM organization; DELETE FROM account; DELETE FROM user; DELETE FROM verification; DELETE FROM session; DELETE FROM invitation;",
  ]);
  const cleanExit = await cleanProc.exited;
  if (cleanExit !== 0) {
    console.error("Cleanup failed");
    process.exit(1);
  }

  console.log("Applying migrations...");
  const migrateProc = Bun.spawn([
    "bunx",
    "wrangler",
    "d1",
    "migrations",
    "apply",
    "my-app-db",
    "--local",
  ]);
  const migrateExit = await migrateProc.exited;
  if (migrateExit !== 0) {
    console.error("Migration failed");
    process.exit(1);
  }

  console.log("Seeding...");

  const now = new Date();
  const timestamp = now.getTime();
  const adminId = crypto.randomUUID();

  try {
    const hashedPassword = await hashPassword(ADMIN_PASSWORD);
    const orgId = crypto.randomUUID();

    const sql = [
      `INSERT INTO "user" ("id", "name", "email", "email_verified", "image", "created_at", "updated_at") VALUES (${esc(adminId)}, ${esc("Admin")}, ${esc(ADMIN_EMAIL)}, 1, NULL, ${timestamp}, ${timestamp});`,
      `INSERT INTO "account" ("id", "account_id", "provider_id", "user_id", "password", "created_at", "updated_at") VALUES (${esc(crypto.randomUUID())}, ${esc(adminId)}, 'credential', ${esc(adminId)}, ${esc(hashedPassword)}, ${timestamp}, ${timestamp});`,
      `INSERT INTO "organization" ("id", "name", "slug", "logo", "created_at", "metadata") VALUES (${esc(orgId)}, ${esc("Personal")}, ${esc("personal")}, NULL, ${timestamp}, NULL);`,
      `INSERT INTO "member" ("id", "organization_id", "user_id", "role", "created_at") VALUES (${esc(crypto.randomUUID())}, ${esc(orgId)}, ${esc(adminId)}, 'owner', ${timestamp});`,
    ].join("\n");

    const proc = Bun.spawn([
      "bunx",
      "wrangler",
      "d1",
      "execute",
      "my-app-db",
      "--local",
      "--command=" + sql,
    ]);
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text();
      console.error("Seed SQL execution failed:", stderr);
      process.exit(1);
    }

    console.log("Seed completed!");
    console.log("Admin account created:");
    console.log(`  Email: ${ADMIN_EMAIL}`);
    console.log(`  Password: ${ADMIN_PASSWORD}`);
    console.log(`  Organization: Personal (owner)`);
  } catch (e) {
    console.error("Seed failed:", e);
    process.exit(1);
  }
}

main();
