import { describe, it, expect } from "bun:test";
import { sql } from "drizzle-orm";
import pkg from "../package.json";
import { account, member, organization, user } from "./schema";
import * as authSchema from "./schema";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  d1Rows,
  seedAdmin,
  seedStatements,
  wranglerFailure,
  type SeedDatabase,
} from "./seed";
import { createTestAuth } from "./testing";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { resetStatements } from "{{SCOPE}}/db/reset";

// The seed writes the rows Better Auth would, with SQL, because it runs against a local D1 through
// `wrangler d1 execute`. What proves it is Better Auth reading them back.
describe("the seed", () => {
  async function seeded() {
    const test = await createTestAuth();
    for (const statement of await seedStatements()) {
      await test.db.run(sql.raw(statement));
    }
    return test;
  }

  it("creates an admin who signs in with the password it announces, through Better Auth", async () => {
    const { auth } = await seeded();

    const signedIn = await auth.api.signInEmail({
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    expect(signedIn.user.email).toBe(ADMIN_EMAIL);
    expect(signedIn.user.emailVerified).toBe(true);
  });

  it("refuses the wrong password: the hash is Better Auth's format, not a placeholder", async () => {
    const { auth } = await seeded();

    await expect(
      auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: "not the password" } }),
    ).rejects.toThrow();
  });

  it("makes the admin the owner of a Personal organization, and opens a session on it", async () => {
    const { auth, db } = await seeded();

    const signedIn = await auth.api.signInEmail({
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    const [row] = await db
      .select({ name: organization.name, role: member.role, id: organization.id })
      .from(member)
      .innerJoin(organization, sql`${member.organizationId} = ${organization.id}`);
    expect(row).toMatchObject({ name: "Personal", role: "owner" });
    expect(signedIn.user.id).toBe((await db.select().from(user))[0]?.id ?? "");
  });

  it("seeds again after the ORM's reset: the admin signs in and the tables are as a first seed leaves them", async () => {
    const { db, call, signIn, auth } = await seeded();
    await signIn("someone@example.com");
    await db.run(sql`PRAGMA foreign_keys = ON`);

    // `db:reset` is `orm/drizzle`'s: it empties every table of the barrel. Here, the auth tables.
    for (const statement of resetStatements(authSchema)) {
      await db.run(sql.raw(statement));
    }
    expect(await db.select().from(user)).toEqual([]);
    for (const statement of await seedStatements()) {
      await db.run(sql.raw(statement));
    }

    expect(
      (await auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } })).user
        .email,
    ).toBe(ADMIN_EMAIL);
    expect((await db.select().from(user)).map(({ email }) => email)).toEqual([ADMIN_EMAIL]);
    expect((await call("/get-session")).status).toBe(200);
  });

  // `seedAdmin` is what `bun run db:seed` runs, over the local D1; here it runs over real SQLite, with
  // the one difference that a batch is run statement by statement, since D1's is a transaction.
  describe("seedAdmin: seeding a database that already has the admin", () => {
    type TestDatabase = Awaited<ReturnType<typeof createTestAuth>>["db"];

    const databaseOf = (db: TestDatabase): SeedDatabase => ({
      rows: async (statement) => db.all<Record<string, unknown>>(sql.raw(statement)),
      batch: async (statements) => {
        for (const statement of statements) {
          await db.run(sql.raw(statement));
        }
      },
    });

    const counts = async (db: TestDatabase) => ({
      user: (await db.select().from(user)).length,
      account: (await db.select().from(account)).length,
      organization: (await db.select().from(organization)).length,
      member: (await db.select().from(member)).length,
    });

    it("seeds an empty database once, and the admin signs in", async () => {
      const { auth, db } = await createTestAuth();

      expect(await seedAdmin(databaseOf(db))).toBe("seeded");

      expect(await counts(db)).toEqual({ user: 1, account: 1, organization: 1, member: 1 });
      expect(
        (await auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }))
          .user.email,
      ).toBe(ADMIN_EMAIL);
    });

    it("does nothing when the admin exists, and says so: no table gains a row, and the admin still signs in", async () => {
      const { auth, db } = await createTestAuth();
      const database = databaseOf(db);
      await seedAdmin(database);
      const before = await counts(db);

      expect(await seedAdmin(database)).toBe("present");
      expect(await seedAdmin(database)).toBe("present");

      expect(await counts(db)).toEqual(before);
      expect(
        (await auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }))
          .user.email,
      ).toBe(ADMIN_EMAIL);
    });

    it("leaves alone a user who signed up with the admin's email, and the password that user chose", async () => {
      const { auth, db, signIn } = await createTestAuth();
      await signIn(ADMIN_EMAIL, "the password someone chose");
      const before = await counts(db);

      expect(await seedAdmin(databaseOf(db))).toBe("present");

      expect(await counts(db)).toEqual(before);
      await expect(
        auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }),
      ).rejects.toThrow();
    });

    it("applies the inserts in one batch, which is what keeps a failed seed from leaving a user with no organization", async () => {
      const { db } = await createTestAuth();
      const batches: string[][] = [];
      const database = databaseOf(db);

      await seedAdmin({
        rows: database.rows,
        batch: async (statements) => {
          batches.push(statements);
          await database.batch(statements);
        },
      });

      expect(batches).toHaveLength(1);
      expect(batches[0]).toHaveLength(4);
    });
  });

  // The shape `wrangler d1 execute --local --json --command` prints: one result for the one statement.
  it("reads the rows wrangler prints for a statement, and refuses what is not a success", () => {
    const printed = (results: unknown[], success = true) =>
      JSON.stringify([{ results, success, meta: { duration: 0 } }]);

    expect(d1Rows(printed([{ id: "a" }]))).toEqual([{ id: "a" }]);
    expect(d1Rows(printed([]))).toEqual([]);
    expect(() => d1Rows(printed([], false))).toThrow(/no successful result/);
    expect(() => d1Rows("[]")).toThrow(/no successful result/);
  });

  // The failed call of a batch carries the admin's password hash in `--command`: the error is what
  // lands in a terminal, a CI log and an issue, so it names the command and withholds the SQL.
  it("reports a failed wrangler call by its command and exit code, and never prints the SQL, whose inserts hold the admin's password hash", async () => {
    const statements = await seedStatements();
    const batch = ["d1", "execute", "DB", "--local", "--command", statements.join("\n")];

    const message = wranglerFailure(batch, 1);

    expect(message).toContain("wrangler d1 execute DB --local --command");
    expect(message).toContain("exited with 1");
    expect(message).not.toContain("INSERT");
    expect(message).not.toMatch(/[0-9a-f]{32}/);
    for (const statement of statements) {
      expect(message).not.toContain(statement);
    }
  });

  it("reports a failed wrangler call with no SQL as it was given", () => {
    expect(wranglerFailure(["d1", "migrations", "apply", "DB", "--local"], 2)).toBe(
      "wrangler d1 migrations apply DB --local exited with 2",
    );
  });

  it("owns db:seed and no db:reset: the reset is the ORM's, and the seed deletes nothing", async () => {
    expect(Object.keys(pkg.scripts).filter((name) => name.startsWith("db:"))).toEqual(["db:seed"]);
    expect(await Bun.file(new URL("./seed.ts", import.meta.url)).text()).not.toContain("DELETE");
  });
});
