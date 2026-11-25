import { beforeAll, describe, it, expect } from "vite-plus/test";
import { Elysia } from "elysia";
import { authPlugin } from "./libsql-auth.module";
import { roles } from "./permissions";
import { TEST_API_URL, createTestAuth } from "./testing";

// `{ permission: { member: ["create"] } }` on a route answers for the active organization's role: 401
// with no session, 403 when the member's role lacks a statement, the handler otherwise.
describe("the permission macro", () => {
  let post: (cookie?: string) => Promise<Response>;
  const cookies = { owner: "", admin: "", member: "" };

  // One organization with a member of each role: signing a user in hashes a password, which is the slow part.
  beforeAll(async () => {
    const test = await createTestAuth();
    cookies.owner = await test.signIn("owner@example.com");
    const created = await test.call("/organization/create", {
      cookie: cookies.owner,
      body: { name: "Team", slug: "team" },
    });
    const { id: organizationId } = (await created.json()) as { id: string };
    for (const role of ["admin", "member"] as const) {
      const cookie = await test.signIn(`${role}@example.com`);
      const current = await test.auth.api.getSession({ headers: new Headers({ cookie }) });
      await test.auth.api.addMember({
        body: { userId: current?.user.id ?? "", role, organizationId },
      });
      await test.call("/organization/set-active", { cookie, body: { organizationId } });
      cookies[role] = cookie;
    }
    const app = new Elysia()
      .use(authPlugin(async () => ({ auth: test.auth, db: test.db })))
      .post("/members", () => ({ added: true }), { permission: { member: ["create"] } });
    post = (cookie) =>
      app.handle(
        new Request(`${TEST_API_URL}/members`, {
          method: "POST",
          headers: cookie === undefined ? {} : { cookie },
        }),
      );
  }, 60_000);

  it("answers 401 without a session", async () => {
    expect((await post()).status).toBe(401);
  });

  it("answers 403 to a member, whose role has no statement on member", async () => {
    expect((await post(cookies.member)).status).toBe(403);
  });

  it.each(["owner", "admin"] as const)("runs the handler for an %s", async (role) => {
    const response = await post(cookies[role]);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ added: true });
  });
});

describe("the organization roles", () => {
  it("are owner, admin and member", () => {
    expect(Object.keys(roles).toSorted()).toEqual(["admin", "member", "owner"]);
  });
});
