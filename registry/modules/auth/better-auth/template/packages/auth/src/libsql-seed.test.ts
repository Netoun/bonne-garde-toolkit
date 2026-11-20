import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createClient } from "@libsql/client";
import { sql } from "drizzle-orm";
import { afterEach, describe, it, expect } from "vite-plus/test";
import pkg from "../package.json";
import { account, member, organization, user } from "./schema";
import {
  ADMIN_EMAIL,
  ADMIN_PASSWORD,
  libsqlSeedDatabase,
  seedAdmin,
  seedLibsql,
  seedStatements,
} from "./libsql-seed";
import { createTestAuth } from "./testing";

// The seed writes the rows Better Auth would, with SQL. What proves it is Better Auth reading them back.
describe("the libsql seed", () => {
  const folders: string[] = [];
  afterEach(async () => {
    await Promise.all(
      folders.splice(0).map((folder) => rm(folder, { recursive: true, force: true })),
    );
  });

  async function scratch(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), "auth-seed-"));
    folders.push(folder);
    return folder;
  }

  type TestDatabase = Awaited<ReturnType<typeof createTestAuth>>["db"];

  const counts = async (db: TestDatabase) => ({
    user: (await db.select().from(user)).length,
    account: (await db.select().from(account)).length,
    organization: (await db.select().from(organization)).length,
    member: (await db.select().from(member)).length,
  });

  it("creates an admin who signs in with the password it announces, through Better Auth", async () => {
    const { auth, db } = await createTestAuth();
    for (const statement of await seedStatements()) {
      await db.run(sql.raw(statement));
    }

    const signedIn = await auth.api.signInEmail({
      body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
    });

    expect(signedIn.user.email).toBe(ADMIN_EMAIL);
    expect(signedIn.user.emailVerified).toBe(true);
    await expect(
      auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: "not the password" } }),
    ).rejects.toThrow();
    const [row] = await db
      .select({ name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, sql`${member.organizationId} = ${organization.id}`);
    expect(row).toMatchObject({ name: "Personal", role: "owner" });
  });

  describe("seedAdmin over the libsql client", () => {
    it("seeds an empty database once, and the admin signs in", async () => {
      const { auth, db } = await createTestAuth();

      expect(await seedAdmin(libsqlSeedDatabase(db.$client))).toBe("seeded");

      expect(await counts(db)).toEqual({ user: 1, account: 1, organization: 1, member: 1 });
      expect(
        (await auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }))
          .user.email,
      ).toBe(ADMIN_EMAIL);
    });

    it("does nothing when the admin exists, and says so: no table gains a row", async () => {
      const { db } = await createTestAuth();
      const database = libsqlSeedDatabase(db.$client);
      await seedAdmin(database);
      const before = await counts(db);

      expect(await seedAdmin(database)).toBe("present");

      expect(await counts(db)).toEqual(before);
    });

    it("leaves alone a user who signed up with the admin's email, and the password that user chose", async () => {
      const { auth, db, signIn } = await createTestAuth();
      await signIn(ADMIN_EMAIL, "the password someone chose");
      const before = await counts(db);

      expect(await seedAdmin(libsqlSeedDatabase(db.$client))).toBe("present");

      expect(await counts(db)).toEqual(before);
      await expect(
        auth.api.signInEmail({ body: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD } }),
      ).rejects.toThrow();
    });

    it("applies the inserts as one transaction: a failed seed leaves no user without its organization", async () => {
      const { db } = await createTestAuth();
      // The slug is unique: a taken `personal` fails the third insert, after the user and the account.
      await db.run(
        sql`INSERT INTO "organization" ("id", "name", "slug", "created_at") VALUES ('taken', 'Taken', 'personal', 0)`,
      );
      const before = await counts(db);

      await expect(seedAdmin(libsqlSeedDatabase(db.$client))).rejects.toThrow();

      expect(await counts(db)).toEqual(before);
    });
  });

  describe("seedLibsql: migrations, then the admin, in a database file", () => {
    /** A migrations folder holding the auth tables, as `db:generate` writes one. */
    async function migrationsFolder(): Promise<string> {
      const { db } = await createTestAuth();
      const { rows } = await db.$client.execute(
        "SELECT sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
      );
      const folder = join(await scratch(), "migrations");
      await mkdir(join(folder, "meta"), { recursive: true });
      await writeFile(
        join(folder, "0000_auth.sql"),
        rows.map((row) => String(row[0])).join("\n--> statement-breakpoint\n"),
      );
      await writeFile(
        join(folder, "meta", "_journal.json"),
        JSON.stringify({
          version: "7",
          dialect: "sqlite",
          entries: [
            { idx: 0, version: "6", when: 1_700_000_000_000, tag: "0000_auth", breakpoints: true },
          ],
        }),
      );
      return folder;
    }

    it("creates the tables in an empty file, seeds the admin, and seeds nothing the second time", async () => {
      const folder = await migrationsFolder();
      const client = createClient({ url: `file:${join(await scratch(), "db.sqlite")}` });

      expect(await seedLibsql(client, folder)).toBe("seeded");
      expect(await seedLibsql(client, folder)).toBe("present");

      const { rows } = await client.execute('SELECT "email", "email_verified" FROM "user"');
      expect(rows.map((row) => [row[0], row[1]])).toEqual([[ADMIN_EMAIL, 1]]);
      client.close();
    });

    it("says to run db:generate when there are no migrations, and writes nothing", async () => {
      const client = createClient({ url: ":memory:" });

      await expect(seedLibsql(client, join(await scratch(), "migrations"))).rejects.toThrow(
        /db:generate/,
      );
      client.close();
    });
  });

  it("owns db:seed and no db:reset, and the seed deletes nothing", async () => {
    expect(Object.keys(pkg.scripts).filter((name) => name.startsWith("db:"))).toEqual(["db:seed"]);
    expect(await readFile(join(import.meta.dirname, "libsql-seed.ts"), "utf8")).not.toContain(
      "DELETE",
    );
  });
});
