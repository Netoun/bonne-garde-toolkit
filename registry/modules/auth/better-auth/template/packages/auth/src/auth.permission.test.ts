import { describe, it, expect } from "vite-plus/test";
import { Elysia } from "elysia";
import { authPlugin } from "./auth.module";
import { roles } from "./permissions";
import { TEST_API_URL, createTestAuth } from "./testing";

// `{ permission: { member: ["create"] } }` on a route answers for the active organization's role: 401
// with no session, 403 when the member's role lacks a statement, the handler otherwise.
describe("the permission macro", () => {
  async function organizationOf(role: "owner" | "admin" | "member") {
    const test = await createTestAuth();
    const ownerCookie = await test.signIn("owner@example.com");
    const created = await test.call("/organization/create", {
      cookie: ownerCookie,
      body: { name: "Team", slug: "team" },
    });
    const { id: organizationId } = (await created.json()) as { id: string };
    const cookie = role === "owner" ? ownerCookie : await test.signIn(`${role}@example.com`);
    if (role !== "owner") {
      const { user } = await test.auth.api.signInEmail({
        body: { email: `${role}@example.com`, password: "correct horse battery staple" },
      });
      await test.auth.api.addMember({ body: { userId: user.id, role, organizationId } });
      await test.call("/organization/set-active", { cookie, body: { organizationId } });
    }
    const app = new Elysia()
      .use(authPlugin(async () => ({ auth: test.auth, db: test.db })))
      .post("/members", () => ({ added: true }), { permission: { member: ["create"] } });
    const post = (headers: Record<string, string> = {}) =>
      app.handle(new Request(`${TEST_API_URL}/members`, { method: "POST", headers }));
    return { post, cookie };
  }

  it("answers 401 without a session", async () => {
    const { post } = await organizationOf("owner");

    expect((await post()).status).toBe(401);
  });

  it("answers 403 to a member, whose role has no statement on member", async () => {
    const { post, cookie } = await organizationOf("member");

    expect((await post({ cookie })).status).toBe(403);
  });

  it.each(["owner", "admin"] as const)("runs the handler for an %s", async (role) => {
    const { post, cookie } = await organizationOf(role);

    const response = await post({ cookie });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ added: true });
  });
});

describe("the organization roles", () => {
  it("are owner, admin and member", () => {
    expect(Object.keys(roles).toSorted()).toEqual(["admin", "member", "owner"]);
  });
});
