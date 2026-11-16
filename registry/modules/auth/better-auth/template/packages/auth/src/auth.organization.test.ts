import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { authPlugin } from "./auth.module";
import { organization, session } from "./schema";
import { TEST_API_URL, createTestAuth } from "./testing";

// `organization.deletedAt` is the soft delete the module reads and no endpoint of Better Auth writes:
// it is set server-side (`input: false`). Better Auth's own organization endpoints do not know it, so
// an organization marked deleted kept appearing in the list, could be fetched with its members, and
// could be made the active one, which scopes what a route reads.
describe("an organization marked deleted", () => {
  async function member() {
    const test = await createTestAuth();
    const cookie = await test.signIn("owner@example.com");
    const created = await test.call("/organization/create", {
      cookie,
      body: { name: "Second", slug: "second", keepCurrentActiveOrganization: true },
    });
    const { id: secondId } = (await created.json()) as { id: string };
    const [personal] = await test.db
      .select()
      .from(organization)
      .where(eq(organization.name, "Personal"));
    const softDelete = (id: string) =>
      test.db.update(organization).set({ deletedAt: new Date() }).where(eq(organization.id, id));
    return { ...test, cookie, secondId, personalId: personal?.id ?? "", softDelete };
  }

  it("is left out of the organizations a user lists", async () => {
    const { call, cookie, secondId, personalId, softDelete } = await member();
    await softDelete(secondId);

    const response = await call("/organization/list", { cookie });
    const listed = (await response.json()) as { id: string }[];

    expect(listed.map(({ id }) => id)).toEqual([personalId]);
  });

  it("cannot be fetched with its members, by id or by slug", async () => {
    const { call, cookie, secondId, softDelete } = await member();
    await softDelete(secondId);

    const byId = await call(`/organization/get-full-organization?organizationId=${secondId}`, {
      cookie,
    });
    const bySlug = await call("/organization/get-full-organization?organizationSlug=second", {
      cookie,
    });

    expect([byId.status, bySlug.status]).toEqual([404, 404]);
  });

  it("cannot be made the active organization, and the session keeps the one it had", async () => {
    const { call, cookie, db, secondId, personalId, softDelete } = await member();
    await softDelete(secondId);

    const response = await call("/organization/set-active", {
      cookie,
      body: { organizationId: secondId },
    });

    const [stored] = await db.select().from(session);
    expect(response.status).toBe(404);
    expect(stored?.activeOrganizationId).toBe(personalId);
  });

  it("stops being the active organization a route reads: the macro falls back to a live one, and keeps it", async () => {
    const { auth, db, call, cookie, secondId, personalId, softDelete } = await member();
    await call("/organization/set-active", { cookie, body: { organizationId: secondId } });
    const app = new Elysia()
      .use(authPlugin(async () => ({ auth, db })))
      .get("/active", ({ session: active }) => ({ id: active.activeOrganizationId }), {
        auth: true,
      });
    await softDelete(secondId);

    const response = await app.handle(
      new Request(`${TEST_API_URL}/active`, { headers: { cookie } }),
    );

    const body: unknown = await response.json();
    expect(body).toEqual({ id: personalId });
    const [stored] = await db.select().from(session);
    expect(stored?.activeOrganizationId).toBe(personalId);
  });

  it("leaves the user with no active organization when every one of theirs is deleted", async () => {
    const { auth, db, cookie, secondId, personalId, softDelete } = await member();
    const app = new Elysia()
      .use(authPlugin(async () => ({ auth, db })))
      .get("/active", ({ session: active }) => ({ id: active.activeOrganizationId ?? null }), {
        auth: true,
      });
    await softDelete(secondId);
    await softDelete(personalId);

    const response = await app.handle(
      new Request(`${TEST_API_URL}/active`, { headers: { cookie } }),
    );

    const body: unknown = await response.json();
    expect(body).toEqual({ id: null });
  });
});
