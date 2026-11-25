import { describe, it, expect } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { invitation, member, organization, signupInvitation, user } from "./schema";
import { createTestAuth } from "./testing";

const PASSWORD = "correct horse battery staple";
const DAY = 24 * 60 * 60 * 1000;

type Overrides = Parameters<typeof createTestAuth>[0];

// With AUTH_SIGNUP=invite an account is created only for someone who holds a signup code or has a
// pending organization invitation, and the gate sits on the user row, so every way of signing up goes through it.
async function started(overrides: Overrides = { signup: "invite" }) {
  const test = await createTestAuth(overrides);
  const signUp = (email: string, extra: Record<string, unknown> = {}) =>
    test.call("/sign-up/email", { body: { email, password: PASSWORD, name: email, ...extra } });
  const codeRow = async (code: string, row: Partial<typeof signupInvitation.$inferInsert> = {}) => {
    await test.db.insert(signupInvitation).values({
      id: crypto.randomUUID(),
      code,
      expiresAt: new Date(Date.now() + DAY),
      ...row,
    });
    return code;
  };
  const rowOf = async (code: string) => {
    const [row] = await test.db
      .select()
      .from(signupInvitation)
      .where(eq(signupInvitation.code, code));
    if (row === undefined) throw new Error(`no signup invitation ${code}`);
    return row;
  };
  const userOf = async (email: string) => {
    const [found] = await test.db.select().from(user).where(eq(user.email, email));
    return found;
  };
  return { ...test, signUp, codeRow, rowOf, userOf };
}

describe("sign-up with AUTH_SIGNUP=invite", () => {
  it("refuses a sign-up with no code and no organization invitation, and creates no user", async () => {
    const { signUp, userOf } = await started();

    const response = await signUp("ada@example.com");

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ code: "SIGNUP_INVITE_REQUIRED" });
    expect(await userOf("ada@example.com")).toBeUndefined();
  });

  it("accepts a valid code, marks it accepted with the user's id, and still gives the Personal organization", async () => {
    const { signUp, codeRow, rowOf, userOf, db } = await started();
    await codeRow("ABCD2345");

    const response = await signUp("ada@example.com", { inviteCode: "ABCD2345" });

    expect(response.status).toBe(200);
    const created = await userOf("ada@example.com");
    expect(await rowOf("ABCD2345")).toMatchObject({
      status: "accepted",
      consumedByUserId: created?.id,
    });
    const memberships = await db
      .select({ name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, created?.id ?? ""));
    expect(memberships).toEqual([{ name: "Personal", role: "owner" }]);
  });

  it("reads the code as it is shown: XXXX-XXXX, in any case", async () => {
    const { signUp, codeRow, rowOf } = await started();
    await codeRow("ABCD2345");

    const response = await signUp("ada@example.com", { inviteCode: "abcd-2345" });

    expect(response.status).toBe(200);
    expect((await rowOf("ABCD2345")).status).toBe("accepted");
  });

  it("refuses a code that is expired, revoked, already used, unknown or not a string", async () => {
    const { signUp, codeRow, userOf } = await started();
    await codeRow("EXPIRED2", { expiresAt: new Date(Date.now() - 1000) });
    await codeRow("REVOKED2", { status: "revoked" });
    await codeRow("USED2222", { status: "accepted" });

    for (const inviteCode of ["EXPIRED2", "REVOKED2", "USED2222", "UNKNOWN2", 12345678]) {
      const response = await signUp(`${String(inviteCode).toLowerCase()}@example.com`, {
        inviteCode,
      });
      expect([inviteCode, response.status]).toEqual([inviteCode, 403]);
      expect(await response.json()).toMatchObject({ code: "SIGNUP_INVITE_REQUIRED" });
    }
    expect(await userOf("expired2@example.com")).toBeUndefined();
  });

  it("refuses a second sign-up with a code the first one used", async () => {
    const { signUp, codeRow } = await started();
    await codeRow("ABCD2345");

    expect((await signUp("ada@example.com", { inviteCode: "ABCD2345" })).status).toBe(200);
    expect((await signUp("bob@example.com", { inviteCode: "ABCD2345" })).status).toBe(403);
  });

  it("refuses a code bound to another email, and accepts it for its own, whatever the case", async () => {
    const { signUp, codeRow, rowOf } = await started();
    await codeRow("BOUND222", { email: "ada@example.com" });

    expect((await signUp("bob@example.com", { inviteCode: "BOUND222" })).status).toBe(403);
    expect((await rowOf("BOUND222")).status).toBe("pending");
    expect((await signUp("Ada@Example.com", { inviteCode: "BOUND222" })).status).toBe(200);
    expect((await rowOf("BOUND222")).status).toBe("accepted");
  });

  describe("with an organization invitation", () => {
    async function invited(email: string, row: Partial<typeof invitation.$inferInsert> = {}) {
      const test = await started();
      const inviterId = crypto.randomUUID();
      await test.db.insert(user).values({
        id: inviterId,
        name: "Owner",
        email: "owner@example.com",
        emailVerified: true,
      });
      const organizationId = crypto.randomUUID();
      await test.db
        .insert(organization)
        .values({ id: organizationId, name: "Team", slug: "team", createdAt: new Date() });
      await test.db.insert(invitation).values({
        id: crypto.randomUUID(),
        organizationId,
        email,
        inviterId,
        expiresAt: new Date(Date.now() + DAY),
        ...row,
      });
      return { ...test, organizationId };
    }

    it("accepts a sign-up with no code when a pending one exists for the email", async () => {
      const { signUp } = await invited("ada@example.com");

      expect((await signUp("Ada@example.com")).status).toBe(200);
    });

    it("refuses it when the invitation is expired, is not pending, or is for another email", async () => {
      for (const row of [
        { expiresAt: new Date(Date.now() - 1000) },
        { status: "accepted" },
        { status: "canceled" },
        { email: "bob@example.com" },
      ]) {
        const { signUp } = await invited("ada@example.com", row);

        const response = await signUp("ada@example.com");

        expect([row, response.status]).toEqual([row, 403]);
      }
    });

    it("refuses it when the organization is soft-deleted", async () => {
      const { signUp, db, organizationId } = await invited("ada@example.com");
      await db
        .update(organization)
        .set({ deletedAt: new Date() })
        .where(eq(organization.id, organizationId));

      expect((await signUp("ada@example.com")).status).toBe(403);
    });

    it("does not fall back to it when a code is given and is not valid", async () => {
      const { signUp, codeRow } = await invited("ada@example.com");
      await codeRow("REVOKED2", { status: "revoked" });

      const response = await signUp("ada@example.com", { inviteCode: "REVOKED2" });

      expect(response.status).toBe(403);
    });

    it("leaves a code alone when the organization invitation was what let the user in", async () => {
      const { signUp, codeRow, rowOf } = await invited("ada@example.com");
      await codeRow("ABCD2345");

      expect((await signUp("ada@example.com")).status).toBe(200);
      expect((await rowOf("ABCD2345")).status).toBe("pending");
    });
  });
});

describe("sign-up with AUTH_SIGNUP open or unset", () => {
  it("accepts a sign-up with no code, as before", async () => {
    for (const overrides of [{}, { signup: "open" as const }]) {
      const { signUp } = await started(overrides);

      expect((await signUp("ada@example.com")).status).toBe(200);
    }
  });

  it("ignores a code, valid or not, and leaves it pending", async () => {
    const { signUp, codeRow, rowOf } = await started({});
    await codeRow("ABCD2345");

    expect((await signUp("ada@example.com", { inviteCode: "ABCD2345" })).status).toBe(200);
    expect((await signUp("bob@example.com", { inviteCode: "NOPE2222" })).status).toBe(200);
    expect((await rowOf("ABCD2345")).status).toBe("pending");
  });
});
