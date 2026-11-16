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

/** What `seedAdmin` needs of a database: a read, and statements that are applied together or not at all. */
export type SeedDatabase = {
  rows(statement: string): Promise<Record<string, unknown>[]>;
  batch(statements: string[]): Promise<void>;
};

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

/** The rows `wrangler d1 execute --json` printed for one statement. */
export function d1Rows(stdout: string): Record<string, unknown>[] {
  const printed: unknown = JSON.parse(stdout);
  const [result] = Array.isArray(printed) ? printed : [];
  if (
    typeof result !== "object" ||
    result === null ||
    !("success" in result) ||
    result.success !== true ||
    !("results" in result) ||
    !Array.isArray(result.results)
  ) {
    throw new Error(`wrangler d1 execute printed no successful result: ${stdout.trim()}`);
  }
  return result.results.filter(
    (row: unknown): row is Record<string, unknown> => typeof row === "object" && row !== null,
  );
}

/** `apps/api`, where `wrangler.jsonc` and the local D1 state are. */
const API_DIRECTORY = new URL("../../../apps/api/", import.meta.url).pathname;

/**
 * What a failed `wrangler` call is reported as: the command and its exit code. The value of
 * `--command` is the SQL, and the batch's inserts hold the admin's password hash, so the error that
 * reaches a terminal or a CI log says how long the SQL was and not what it said. Wrangler explains the
 * failure itself, on the stderr this process shares.
 */
export function wranglerFailure(args: string[], exitCode: number): string {
  const shown = args.map((arg, index) =>
    args[index - 1] === "--command" ? `<SQL withheld, ${arg.length} characters>` : arg,
  );
  return `wrangler ${shown.join(" ")} exited with ${exitCode}`;
}

/** Runs `wrangler` in `apps/api` and returns what it printed; `inherit` shows it instead, and returns "". */
async function wrangler(args: string[], stdout: "pipe" | "inherit"): Promise<string> {
  const wranglerProcess = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: API_DIRECTORY,
    stdin: "ignore",
    stdout,
    stderr: "inherit",
    env: { ...Bun.env, WRANGLER_SEND_METRICS: "false" },
  });
  const printed = stdout === "pipe" ? await new Response(wranglerProcess.stdout).text() : "";
  const exitCode = await wranglerProcess.exited;
  if (exitCode !== 0) {
    throw new Error(wranglerFailure(args, exitCode));
  }
  return printed;
}

/** The local D1 the binding `DB` names in `apps/api/wrangler.jsonc`. */
const localD1: SeedDatabase = {
  rows: async (statement) =>
    d1Rows(
      await wrangler(["d1", "execute", "DB", "--local", "--json", "--command", statement], "pipe"),
    ),
  batch: async (statements) => {
    await wrangler(
      ["d1", "execute", "DB", "--local", "--command", statements.join("\n")],
      "inherit",
    );
  },
};

/**
 * `bun run db:seed`: applies the migrations to the local D1 the binding `DB` names in
 * `apps/api/wrangler.jsonc`, then inserts the admin. It deletes nothing: on a database that already has
 * the admin it says so and exits 0, and `bun run db:reset` (the ORM's, which empties every table of the
 * schema barrel) comes first to start over.
 */
async function main(): Promise<void> {
  await wrangler(["d1", "migrations", "apply", "DB", "--local"], "inherit");
  const message =
    (await seedAdmin(localD1)) === "seeded"
      ? `Seeded: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}, owner of the Personal organization\n`
      : `Already seeded: ${ADMIN_EMAIL} exists, so nothing was changed\n`;
  await Bun.write(Bun.stdout, message);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    await Bun.write(Bun.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
