import { describe, it, expect } from "bun:test";
import { sql } from "drizzle-orm";
import pkg from "../package.json";
import { member, organization, user } from "./schema";
import * as authSchema from "./schema";
import { ADMIN_EMAIL, ADMIN_PASSWORD, seedStatements } from "./seed";
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

  it("clears nothing: a second seed without a reset is refused on the admin's email, and adds no row", async () => {
    const { db } = await seeded();

    const again = async () => {
      for (const statement of await seedStatements()) {
        await db.run(sql.raw(statement));
      }
    };

    await expect(again()).rejects.toThrow(/Failed to run the query/);
    expect(await db.select().from(user)).toHaveLength(1);
    expect(await db.select().from(organization)).toHaveLength(1);
    expect(await db.select().from(member)).toHaveLength(1);
  });

  it("owns db:seed and no db:reset: the reset is the ORM's, and the seed deletes nothing", async () => {
    expect(Object.keys(pkg.scripts).filter((name) => name.startsWith("db:"))).toEqual(["db:seed"]);
    expect(await Bun.file(new URL("./seed.ts", import.meta.url)).text()).not.toContain("DELETE");
  });
});
