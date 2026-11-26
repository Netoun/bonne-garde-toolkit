import { afterEach, describe, it, expect, vi } from "vite-plus/test";
import { eq } from "drizzle-orm";
import { member, organization, user, verification } from "./schema";
import { createTestAuth } from "./testing";

const EMAIL = "ada@example.com";
const FIVE_MINUTES = 5 * 60 * 1000;

/** The `token` query param of a link the mailer was handed. */
function tokenOf(url: string): string {
  const token = new URL(url).searchParams.get("token");
  if (token === null) throw new Error(`the link ${url} has no token`);
  return token;
}

// A magic link signs a user in with the inbox alone: the token in the email is the only secret, so
// what the database keeps of it, how long it lives and how often it opens are what these pin.
describe("magic link sign-in", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  async function requested(email = EMAIL, overrides: Parameters<typeof createTestAuth>[0] = {}) {
    const test = await createTestAuth(overrides);
    const response = await test.call("/sign-in/magic-link", { body: { email } });
    return { ...test, response };
  }

  /** Opens a link the way the browser does: a GET on the URL the email carries. */
  function open(call: Awaited<ReturnType<typeof createTestAuth>>["call"], url: string) {
    const { pathname, search } = new URL(url);
    return call(pathname.replace(/^\/api\/auth/, "") + search);
  }

  it("signs an unknown email in on first open: a verified user, a Personal organization, a session", async () => {
    const { response, magicLinks, call, db } = await requested();

    expect(response.status).toBe(200);
    expect(magicLinks).toHaveLength(1);
    expect(magicLinks[0]?.to).toBe(EMAIL);

    const opened = await open(call, magicLinks[0]?.url ?? "");

    expect(opened.status).toBe(302);
    const cookie = opened.headers
      .getSetCookie()
      .map((entry) => entry.split(";")[0])
      .join("; ");
    const session = await call("/get-session", { cookie });
    expect(((await session.json()) as { user: { email: string } }).user.email).toBe(EMAIL);

    const [created] = await db.select().from(user).where(eq(user.email, EMAIL));
    expect(created?.emailVerified).toBe(true);
    const memberships = await db
      .select({ name: organization.name, role: member.role })
      .from(member)
      .innerJoin(organization, eq(member.organizationId, organization.id))
      .where(eq(member.userId, created?.id ?? ""));
    expect(memberships).toEqual([{ name: "Personal", role: "owner" }]);
  });

  it("stores the token hashed: no row of the verification table holds the one the link carries", async () => {
    const { magicLinks, db } = await requested();
    const token = tokenOf(magicLinks[0]?.url ?? "");

    const rows = await db.select().from(verification);

    expect(rows).toHaveLength(1);
    expect(token.length).toBeGreaterThan(16);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("refuses a link opened a second time", async () => {
    const { magicLinks, call } = await requested();
    const url = magicLinks[0]?.url ?? "";

    const first = await open(call, url);
    const second = await open(call, url);

    expect(first.headers.getSetCookie().length).toBeGreaterThan(0);
    expect(second.status).toBe(302);
    expect(second.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(second.headers.getSetCookie()).toEqual([]);
  });

  it("refuses a link older than 5 minutes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { magicLinks, call } = await requested();
    const url = magicLinks[0]?.url ?? "";

    vi.setSystemTime(Date.now() + FIVE_MINUTES + 1000);
    const late = await open(call, url);

    expect(late.headers.get("location")).toContain("error=INVALID_TOKEN");
    expect(late.headers.getSetCookie()).toEqual([]);
  });

  it("opens a link 4 minutes after it was asked for", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const { magicLinks, call } = await requested();

    vi.setSystemTime(Date.now() + 4 * 60 * 1000);
    const opened = await open(call, magicLinks[0]?.url ?? "");

    expect(opened.headers.getSetCookie().length).toBeGreaterThan(0);
  });

  it("verifies the email of an existing user who never opened the verification link", async () => {
    const test = await createTestAuth();
    await test.call("/sign-up/email", {
      body: { email: EMAIL, password: "correct horse battery staple", name: "Ada" },
    });
    const [before] = await test.db.select().from(user).where(eq(user.email, EMAIL));
    expect(before?.emailVerified).toBe(false);

    await test.call("/sign-in/magic-link", { body: { email: EMAIL } });
    const opened = await open(test.call, test.magicLinks[0]?.url ?? "");

    expect(opened.headers.getSetCookie().length).toBeGreaterThan(0);
    const [after] = await test.db.select().from(user).where(eq(user.email, EMAIL));
    expect(after?.emailVerified).toBe(true);
  });

  describe("with a mailer that has no sendMagicLink", () => {
    it("answers the request, sends nothing, and logs a warning that holds no token", async () => {
      const lines: string[] = [];
      const logger = {
        info() {},
        error() {},
        warn: (message: string, context?: Record<string, unknown>) =>
          lines.push(JSON.stringify({ message, ...context })),
      };
      const { response, magicLinks, db } = await requested(EMAIL, {
        logger,
        mailer: { sendMagicLink: undefined },
      });

      expect(response.status).toBe(200);
      expect(magicLinks).toEqual([]);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain("the magic link email was not sent");
      expect(lines[0]).not.toContain(EMAIL);
      // The row is stored hashed: its identifier is not something a log line could leak as a token.
      const [row] = await db.select().from(verification);
      expect(lines[0]).not.toContain(row?.identifier ?? "missing");
    });
  });
});
