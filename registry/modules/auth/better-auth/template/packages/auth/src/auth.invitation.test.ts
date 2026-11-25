import { describe, it, expect } from "vite-plus/test";
import { and, desc, eq } from "drizzle-orm";
import { unconfiguredMailer } from "./mailer";
import { invitation, member, organization, session, user } from "./schema";
import { TEST_APP_URL, createTestAuth } from "./testing";

const PASSWORD = "correct horse battery staple";
const WEEK = 7 * 24 * 60 * 60 * 1000;

// An invitation is a row Better Auth stores and nobody hears about unless auth mails it, and it
// is the sign-in of the invitee that turns it into a membership: the link is a courtesy.
describe("organization invitations", () => {
  async function owner(overrides: Parameters<typeof createTestAuth>[0] = {}) {
    const test = await createTestAuth(overrides);
    const cookie = await test.signIn("owner@example.com");
    const created = await test.call("/organization/create", {
      cookie,
      body: { name: "Team", slug: "team" },
    });
    const { id: organizationId } = (await created.json()) as { id: string };
    const invite = (
      email: string,
      role: "admin" | "member" = "member",
      organizationId_ = organizationId,
    ) =>
      test.call("/organization/invite-member", {
        cookie,
        body: { email, role, organizationId: organizationId_ },
      });
    const invitationOf = async (email: string) => {
      const [row] = await test.db
        .select()
        .from(invitation)
        .where(eq(invitation.email, email))
        .orderBy(desc(invitation.createdAt));
      if (row === undefined) throw new Error(`no invitation was stored for ${email}`);
      return row;
    };
    const membersOf = async (email: string, orgId = organizationId) => {
      const [found] = await test.db.select().from(user).where(eq(user.email, email));
      return test.db
        .select()
        .from(member)
        .where(and(eq(member.userId, found?.id ?? ""), eq(member.organizationId, orgId)));
    };
    const activeOrganizationOf = async (email: string) => {
      const [found] = await test.db.select().from(user).where(eq(user.email, email));
      const [latest] = await test.db
        .select()
        .from(session)
        .where(eq(session.userId, found?.id ?? ""))
        .orderBy(desc(session.createdAt));
      return latest?.activeOrganizationId ?? null;
    };
    return {
      ...test,
      cookie,
      organizationId,
      invite,
      invitationOf,
      membersOf,
      activeOrganizationOf,
    };
  }

  describe("the email", () => {
    it("is handed to the mailer with the link, the inviter and the organization, and expires in 7 days", async () => {
      const { invite, invitations, invitationOf, organizationId } = await owner();
      const before = Date.now();

      const response = await invite("new@example.com");

      expect(response.status).toBe(200);
      const stored = await invitationOf("new@example.com");
      expect(invitations).toEqual([
        {
          to: "new@example.com",
          inviterName: "owner@example.com",
          organizationName: "Team",
          url: `${TEST_APP_URL}/invitations/${stored.id}`,
        },
      ]);
      expect(stored.organizationId).toBe(organizationId);
      expect(Math.abs(stored.expiresAt.getTime() - (before + WEEK))).toBeLessThan(60_000);
    }, 60_000);

    it("is not sent by a project with no email module: the invite succeeds and the warning has no link", async () => {
      const lines: string[] = [];
      const logger = {
        info() {},
        error() {},
        warn: (message: string, context?: Record<string, unknown>) =>
          lines.push(JSON.stringify({ message, ...context })),
      };
      const { invite, invitationOf } = await owner({
        logger,
        mailer: { sendInvitation: unconfiguredMailer(logger).sendInvitation },
      });

      const response = await invite("new@example.com");

      expect(response.status).toBe(200);
      const stored = await invitationOf("new@example.com");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("the invitation email was not sent");
      expect(lines[0]).not.toContain("/invitations/");
      expect(lines[0]).not.toContain(stored.id);
    }, 60_000);

    it("is not sent either by a mailer with no sendInvitation, and the invite still succeeds", async () => {
      const lines: string[] = [];
      const { invite, invitationOf } = await owner({
        logger: { info() {}, error() {}, warn: (message) => lines.push(message) },
        mailer: { sendInvitation: undefined },
      });

      const response = await invite("new@example.com");

      expect(response.status).toBe(200);
      await invitationOf("new@example.com");
      expect(lines.filter((line) => line.includes("invitation email was not sent"))).toHaveLength(
        1,
      );
    }, 60_000);
  });

  describe("accepted at sign-in", () => {
    it("makes the invitee a member with the invited role and the inviting organization the active one", async () => {
      const { invite, signIn, invitationOf, membersOf, activeOrganizationOf, organizationId } =
        await owner();
      await invite("new@example.com", "admin");

      await signIn("new@example.com");

      expect(await membersOf("new@example.com")).toMatchObject([{ role: "admin" }]);
      expect((await invitationOf("new@example.com")).status).toBe("accepted");
      expect(await activeOrganizationOf("new@example.com")).toBe(organizationId);
    }, 60_000);

    it("matches the email whatever its case", async () => {
      const { invite, signIn, db, membersOf } = await owner();
      await invite("new@example.com");
      await db
        .update(invitation)
        .set({ email: "New@Example.com" })
        .where(eq(invitation.email, "new@example.com"));

      await signIn("new@example.com");

      expect(await membersOf("new@example.com")).toHaveLength(1);
    }, 60_000);

    it("leaves one member row when the invitee signs in again", async () => {
      const { invite, signIn, call, membersOf } = await owner();
      await invite("new@example.com");
      await signIn("new@example.com");

      const again = await call("/sign-in/email", {
        body: { email: "new@example.com", password: PASSWORD },
      });

      expect(again.status).toBe(200);
      expect(await membersOf("new@example.com")).toHaveLength(1);
    }, 60_000);

    it("leaves one member row, and marks the invitation accepted, for a user who already is a member", async () => {
      const { auth, invite, signIn, call, invitationOf, membersOf, organizationId } = await owner();
      const cookie = await signIn("new@example.com");
      await invite("new@example.com");
      const current = await auth.api.getSession({ headers: new Headers({ cookie }) });
      await auth.api.addMember({
        body: { userId: current?.user.id ?? "", role: "member", organizationId },
      });

      await call("/sign-in/email", { body: { email: "new@example.com", password: PASSWORD } });

      expect(await membersOf("new@example.com")).toHaveLength(1);
      expect((await invitationOf("new@example.com")).status).toBe("accepted");
    }, 60_000);

    it("keeps the first live organization active when the invitation is for none, and accepts the most recent one otherwise", async () => {
      const { invite, signIn, organizationId, activeOrganizationOf, cookie, call } = await owner();
      const created = await call("/organization/create", {
        cookie,
        body: { name: "Second", slug: "second", keepCurrentActiveOrganization: true },
      });
      const { id: secondId } = (await created.json()) as { id: string };
      await invite("new@example.com", "member", organizationId);
      await new Promise((resolve) => setTimeout(resolve, 5));
      await invite("new@example.com", "member", secondId);

      await signIn("new@example.com");

      expect(await activeOrganizationOf("new@example.com")).toBe(secondId);
    }, 60_000);

    describe("is refused", () => {
      it("for an expired invitation", async () => {
        const { invite, signIn, db, invitationOf, membersOf } = await owner();
        await invite("new@example.com");
        await db
          .update(invitation)
          .set({ expiresAt: new Date(Date.now() - 1000) })
          .where(eq(invitation.email, "new@example.com"));

        await signIn("new@example.com");

        expect(await membersOf("new@example.com")).toHaveLength(0);
        expect((await invitationOf("new@example.com")).status).toBe("pending");
      }, 60_000);

      it("for a cancelled invitation", async () => {
        const { invite, signIn, call, cookie, invitationOf, membersOf } = await owner();
        await invite("new@example.com");
        const { id } = await invitationOf("new@example.com");
        await call("/organization/cancel-invitation", { cookie, body: { invitationId: id } });

        await signIn("new@example.com");

        expect(await membersOf("new@example.com")).toHaveLength(0);
        expect((await invitationOf("new@example.com")).status).toBe("canceled");
      }, 60_000);

      it("for another email", async () => {
        const { invite, signIn, membersOf, invitationOf } = await owner();
        await invite("someone@example.com");

        await signIn("new@example.com");

        expect(await membersOf("new@example.com")).toHaveLength(0);
        expect((await invitationOf("someone@example.com")).status).toBe("pending");
      }, 60_000);

      it("for an organization marked deleted", async () => {
        const { invite, signIn, db, organizationId, invitationOf, membersOf } = await owner();
        await invite("new@example.com");
        await db
          .update(organization)
          .set({ deletedAt: new Date() })
          .where(eq(organization.id, organizationId));

        await signIn("new@example.com");

        expect(await membersOf("new@example.com")).toHaveLength(0);
        expect((await invitationOf("new@example.com")).status).toBe("pending");
      }, 60_000);
    });
  });
});
