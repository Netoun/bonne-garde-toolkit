import { describe, it, expect } from "vite-plus/test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { authPlugin } from "./libsql-auth.module";
import { invitation, member, organization, session } from "./schema";
import { TEST_API_URL, createTestAuth } from "./testing";

// Better Auth's `organization/delete` removes the row and, by foreign key cascade, its members and
// invitations. Here it marks `organization.deletedAt` instead: the rows stay, every reader of the
// module already filters on it.
describe("deleting an organization", () => {
  async function team() {
    const test = await createTestAuth();
    const cookie = await test.signIn("owner@example.com");
    const created = await test.call("/organization/create", {
      cookie,
      body: { name: "Team", slug: "team" },
    });
    const { id: organizationId } = (await created.json()) as { id: string };
    const remove = (as: string, id = organizationId) =>
      test.call("/organization/delete", { cookie: as, body: { organizationId: id } });
    const deletedAtOf = async (id = organizationId) => {
      const [row] = await test.db.select().from(organization).where(eq(organization.id, id));
      if (row === undefined) throw new Error("the organization row is gone");
      return row.deletedAt;
    };
    const join = async (email: string, role: "admin" | "member") => {
      const joined = await test.signIn(email);
      const current = await test.auth.api.getSession({ headers: new Headers({ cookie: joined }) });
      await test.auth.api.addMember({
        body: { userId: current?.user.id ?? "", role, organizationId },
      });
      return joined;
    };
    return { ...test, cookie, organizationId, remove, deletedAtOf, join };
  }

  it("by its owner marks it deleted, keeps its rows and drops it from the list", async () => {
    const { call, db, cookie, organizationId, remove, deletedAtOf } = await team();

    const response = await remove(cookie);

    expect(response.status).toBe(200);
    expect(await deletedAtOf()).toBeInstanceOf(Date);
    const members = await db.select().from(member).where(eq(member.organizationId, organizationId));
    expect(members).toHaveLength(1);
    const listed = (await (await call("/organization/list", { cookie })).json()) as {
      id: string;
    }[];
    expect(listed.map(({ id }) => id)).not.toContain(organizationId);
  }, 30_000);

  it.each(["admin", "member"] as const)(
    "by an %s is refused, and the organization stays live",
    async (role) => {
      const { join, remove, deletedAtOf } = await team();
      const cookie = await join(`${role}@example.com`, role);

      const response = await remove(cookie);

      expect(response.status).toBe(403);
      expect(await deletedAtOf()).toBeNull();
    },
    30_000,
  );

  it("by someone who is not a member is refused, and the organization stays live", async () => {
    const { signIn, remove, deletedAtOf } = await team();
    const cookie = await signIn("stranger@example.com");

    const response = await remove(cookie);

    expect(response.ok).toBe(false);
    expect(await deletedAtOf()).toBeNull();
  }, 30_000);

  it("without a session is refused", async () => {
    const { call, organizationId, deletedAtOf } = await team();

    const response = await call("/organization/delete", { body: { organizationId } });

    expect(response.status).toBe(401);
    expect(await deletedAtOf()).toBeNull();
  }, 30_000);

  it("an organization already deleted answers 404 and keeps its first deletedAt", async () => {
    const { remove, cookie, deletedAtOf } = await team();
    await remove(cookie);
    const first = await deletedAtOf();

    const again = await remove(cookie);

    expect(again.status).toBe(404);
    expect(await deletedAtOf()).toEqual(first);
  }, 30_000);

  it("leaves a route with `auth: true` reading another live organization when it was the active one", async () => {
    const { auth, db, call, cookie, organizationId, remove } = await team();
    await call("/organization/set-active", { cookie, body: { organizationId } });
    const app = new Elysia()
      .use(authPlugin(async () => ({ auth, db })))
      .get("/active", ({ session: active }) => ({ id: active.activeOrganizationId }), {
        auth: true,
      });

    await remove(cookie);
    const response = await app.handle(
      new Request(`${TEST_API_URL}/active`, { headers: { cookie } }),
    );

    const [personal] = await db
      .select()
      .from(organization)
      .where(eq(organization.name, "Personal"));
    expect(await response.json()).toEqual({ id: personal?.id });
    const [stored] = await db.select().from(session);
    expect(stored?.activeOrganizationId).toBe(personal?.id);
  }, 30_000);
});

describe("accepting an invitation to a deleted organization", () => {
  it("answers 404 and creates no member", async () => {
    const test = await createTestAuth();
    const cookie = await test.signIn("owner@example.com");
    const created = await test.call("/organization/create", {
      cookie,
      body: { name: "Team", slug: "team" },
    });
    const { id: organizationId } = (await created.json()) as { id: string };
    await test.call("/organization/invite-member", {
      cookie,
      body: { email: "invitee@example.com", role: "member", organizationId },
    });
    await test.call("/organization/delete", { cookie, body: { organizationId } });
    // Signing in after the delete: the auto-accept at sign-in already skips a deleted organization.
    const invitee = await test.signIn("invitee@example.com");
    const [pending] = await test.db.select().from(invitation);

    const response = await test.call("/organization/accept-invitation", {
      cookie: invitee,
      body: { invitationId: pending?.id },
    });

    expect(response.status).toBe(404);
    const members = await test.db
      .select()
      .from(member)
      .where(eq(member.organizationId, organizationId));
    expect(members).toHaveLength(1);
  }, 30_000);
});
