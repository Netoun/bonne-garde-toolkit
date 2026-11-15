import { hashPassword } from "./password";

export const ADMIN_EMAIL = "admin@example.local";
export const ADMIN_PASSWORD = "password123";

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

/** `apps/api`, where `wrangler.jsonc` and the local D1 state are. */
const API_DIRECTORY = new URL("../../../apps/api/", import.meta.url).pathname;

async function wrangler(...args: string[]): Promise<void> {
  const wranglerProcess = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: API_DIRECTORY,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Bun.env, WRANGLER_SEND_METRICS: "false" },
  });
  if ((await wranglerProcess.exited) !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
}

/**
 * `bun run db:seed`: applies the migrations to the local D1 the binding `DB` names in
 * `apps/api/wrangler.jsonc`, then inserts the admin. It deletes nothing: on a database that already has
 * the admin it fails on the unique email, and `bun run db:reset` (the ORM's, which empties every table of
 * the schema barrel) comes first.
 */
async function main(): Promise<void> {
  await wrangler("d1", "migrations", "apply", "DB", "--local");
  await wrangler(
    "d1",
    "execute",
    "DB",
    "--local",
    "--command",
    (await seedStatements()).join("\n"),
  );
  await Bun.write(
    Bun.stdout,
    `Seeded: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}, owner of the Personal organization\n`,
  );
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    await Bun.write(Bun.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
