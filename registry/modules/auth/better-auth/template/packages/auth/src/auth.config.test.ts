import { describe, it, expect } from "bun:test";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { user } from "./schema";
import { TEST_API_URL, createTestAuth } from "./testing";

describe("createAuth security defaults", () => {
  it("keeps origin and CSRF protection on, also under NODE_ENV=test", async () => {
    const { auth } = await createTestAuth();
    const context = await auth.$context;

    expect(context.skipOriginCheck).toBe(false);
    expect(context.skipCSRFCheck).toBe(false);
  });

  it("issues httpOnly, lax session cookies, Secure only over https", async () => {
    const { auth } = await createTestAuth();
    const context = await auth.$context;

    expect(context.authCookies.sessionToken.attributes).toMatchObject({
      httpOnly: true,
      sameSite: "lax",
      secure: TEST_API_URL.startsWith("https://"),
    });
  });
});

describe("createTestAuth", () => {
  it("puts the tables a module brings in the same database as auth's, so its tests sign in over it", async () => {
    const notes = sqliteTable("notes", {
      id: integer("id").primaryKey({ autoIncrement: true }),
      body: text("body").notNull(),
    });
    const { db, signIn } = await createTestAuth({}, { notes });

    const cookie = await signIn("ada@example.com");
    await db.insert(notes).values({ body: "first" });

    expect(cookie).toContain("session_token");
    expect(await db.select().from(notes)).toEqual([{ id: 1, body: "first" }]);
    expect((await db.select().from(user)).map(({ email }) => email)).toEqual(["ada@example.com"]);
  });
});
