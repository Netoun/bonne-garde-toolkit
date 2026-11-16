import { describe, it, expect } from "bun:test";
import { Elysia } from "elysia";
import { eq } from "drizzle-orm";
import { config } from "{{SCOPE}}/api/lib/app.config";
import { authPlugin } from "./auth.module";
import { member, organization, session, user } from "./schema";
import { AUTH_BASE_PATH } from "./client";
import { TEST_API_URL, TEST_APP_URL, createTestAuth } from "./testing";

const PASSWORD = "correct horse battery staple";

describe("sign-up, verification and sign-in", () => {
  it("emails a link to the front-end's verify page, and gives the user a Personal organization it owns", async () => {
    const { call, db, sent } = await createTestAuth();

    const response = await call("/sign-up/email", {
      body: { email: "ada@example.com", password: PASSWORD, name: "Ada" },
    });

    expect(response.status).toBe(200);
    expect(sent).toHaveLength(1);
    const [mail] = sent;
    expect(mail).toMatchObject({ kind: "verification", to: "ada@example.com", name: "Ada" });
    const link = new URL(mail?.url ?? "");
    expect(`${link.origin}${link.pathname}`).toBe(`${TEST_APP_URL}/auth/verify-email`);
    expect(link.searchParams.get("token")).toBeTruthy();

    const [created] = await db.select().from(user).where(eq(user.email, "ada@example.com"));
    const memberships = await db
      .select({ name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, created?.id ?? ""));
    expect(memberships).toEqual([{ name: "Personal", role: "owner" }]);
  });

  it("refuses to sign in until the email is verified", async () => {
    const { call, sent, auth } = await createTestAuth();
    await call("/sign-up/email", {
      body: { email: "bob@example.com", password: PASSWORD, name: "Bob" },
    });

    const before = await call("/sign-in/email", {
      body: { email: "bob@example.com", password: PASSWORD },
    });
    expect(before.status).toBe(403);

    const token = new URL(sent[0]?.url ?? "").searchParams.get("token") ?? "";
    await auth.api.verifyEmail({ query: { token } });
    const after = await call("/sign-in/email", {
      body: { email: "bob@example.com", password: PASSWORD },
    });
    expect(after.status).toBe(200);
  });

  it("refuses a wrong password", async () => {
    const { call, signIn } = await createTestAuth();
    await signIn("cy@example.com");

    const response = await call("/sign-in/email", {
      body: { email: "cy@example.com", password: "not the password" },
    });

    expect(response.status).toBe(401);
  });

  it("opens a session whose active organization is the user's first", async () => {
    const { call, signIn, db } = await createTestAuth();
    const cookie = await signIn("dee@example.com");

    const response = await call("/get-session", { cookie });
    const body: unknown = await response.json();

    const [personal] = await db.select().from(organization);
    expect(body).toMatchObject({
      user: { email: "dee@example.com" },
      session: { activeOrganizationId: personal?.id },
    });
  });
});

describe("the auth plugin on an Elysia app", () => {
  async function appWithMe() {
    const test = await createTestAuth();
    const app = new Elysia().use(authPlugin(async () => ({ auth: test.auth, db: test.db }))).get(
      "/me",
      ({ user: current, session: active }) => ({
        email: current.email,
        organizationId: active.activeOrganizationId,
      }),
      { auth: true },
    );
    return { ...test, app };
  }

  it("answers 401 on a route that asks for auth, with no session", async () => {
    const { app } = await appWithMe();

    const response = await app.handle(new Request(`${TEST_API_URL}/me`));

    expect(response.status).toBe(401);
  });

  it("hands the user and the active organization to a route that asks for auth, with one", async () => {
    const { app, signIn, db } = await appWithMe();
    const cookie = await signIn("eve@example.com");

    const response = await app.handle(new Request(`${TEST_API_URL}/me`, { headers: { cookie } }));

    const [personal] = await db.select().from(organization);
    expect(response.status).toBe(200);
    const body: unknown = await response.json();
    expect(body).toEqual({ email: "eve@example.com", organizationId: personal?.id });
  });

  it("falls back to the user's first organization when the session has none, and keeps it", async () => {
    const { app, signIn, db } = await appWithMe();
    const cookie = await signIn("fay@example.com");
    await db.update(session).set({ activeOrganizationId: null });

    const response = await app.handle(new Request(`${TEST_API_URL}/me`, { headers: { cookie } }));

    const [personal] = await db.select().from(organization);
    const body: unknown = await response.json();
    expect(body).toMatchObject({ organizationId: personal?.id });
    const [stored] = await db.select().from(session);
    expect(stored?.activeOrganizationId).toBe(personal?.id);
  });

  it("answers a preflight for an origin the API allows, and not for another", async () => {
    const { app } = await appWithMe();
    const preflight = (origin: string) =>
      app.handle(
        new Request(`${TEST_API_URL}/auth/sign-in/email`, {
          method: "OPTIONS",
          headers: { origin },
        }),
      );

    const allowed = await preflight(config.SPA_URL);
    const refused = await preflight("https://evil.example");

    expect(allowed.status).toBe(204);
    expect(allowed.headers.get("access-control-allow-origin")).toBe(config.SPA_URL);
    expect(allowed.headers.get("access-control-allow-credentials")).toBe("true");
    expect(refused.headers.get("access-control-allow-origin")).toBeNull();
  });
});

// The `dockerfile` provider serves the SPA and the API from one origin, and the SPA has pages at
// `/auth/login`, `/auth/verify-email` and the like: the links in the emails open them. Better Auth
// served its API at `/auth` too, so on that origin a link to the SPA's verify page reached the API,
// which answered it with JSON instead of the page.
describe("where auth is served", () => {
  const spaPages = [
    "/auth/login",
    "/auth/register",
    "/auth/forgot-password",
    "/auth/reset-password?token=t",
    "/auth/verify-email?token=t",
  ];

  it("serves the API under /api/auth, which the client reaches by AUTH_BASE_PATH", async () => {
    const { auth, db } = await createTestAuth();
    const app = new Elysia().use(authPlugin(async () => ({ auth, db })));

    const response = await app.handle(new Request(`${TEST_API_URL}${AUTH_BASE_PATH}/get-session`));

    expect(AUTH_BASE_PATH).toBe("/api/auth");
    expect(response.status).toBe(200);
  });

  it("leaves the front-end's /auth/* pages to the SPA: a 404 is what its fallback answers with the page", async () => {
    const { auth, db } = await createTestAuth();
    const app = new Elysia().use(authPlugin(async () => ({ auth, db })));

    for (const page of spaPages) {
      const response = await app.handle(
        new Request(`${TEST_API_URL}${page}`, { headers: { accept: "text/html" } }),
      );

      expect([page, response.status]).toEqual([page, 404]);
    }
  });
});
