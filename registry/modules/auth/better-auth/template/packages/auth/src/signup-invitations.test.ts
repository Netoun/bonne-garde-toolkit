import { describe, it, expect } from "vite-plus/test";
import { eq } from "drizzle-orm";
import type { AuthMailer, AuthSignupInvitationEmail } from "./mailer";
import { signupInvitation } from "./schema";
import { issueSignupInvitation } from "./signup-invitations";
import { TEST_APP_URL, createTestAuth } from "./testing";

const SHOWN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}-[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{4}$/;
const DAY = 24 * 60 * 60 * 1000;

async function issuer() {
  const { db } = await createTestAuth();
  const sent: AuthSignupInvitationEmail[] = [];
  const warnings: string[] = [];
  const withMailer = (mailer: Partial<AuthMailer>) => ({
    db,
    appURL: TEST_APP_URL,
    mailer: {
      async sendVerificationEmail() {},
      async sendPasswordReset() {},
      ...mailer,
    },
    logger: { warn: (message: string) => warnings.push(message) },
  });
  return {
    db,
    sent,
    warnings,
    deps: withMailer({
      async sendSignupInvitation(email) {
        sent.push(email);
      },
    }),
    depsWithoutMethod: withMailer({}),
  };
}

describe("issueSignupInvitation", () => {
  it("returns a XXXX-XXXX code and the register url, and stores it pending for 7 days", async () => {
    const { deps, db, sent } = await issuer();
    const before = Date.now();

    const { code, url } = await issueSignupInvitation(deps, {});

    expect(code).toMatch(SHOWN);
    expect(url).toBe(`${TEST_APP_URL}/auth/register?code=${code}`);
    const [row] = await db
      .select()
      .from(signupInvitation)
      .where(eq(signupInvitation.code, code.replace("-", "")));
    expect(row).toMatchObject({ status: "pending", email: null, consumedByUserId: null });
    expect(row?.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 7 * DAY);
    expect(row?.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 7 * DAY);
    expect(sent).toEqual([]);
  });

  it("sends the code through the mailer when an email is given, and stores that email lowercased", async () => {
    const { deps, db, sent } = await issuer();

    const { code, url } = await issueSignupInvitation(deps, { email: " Ada@Example.com " });

    expect(sent).toEqual([{ to: "ada@example.com", code, url }]);
    const [row] = await db
      .select()
      .from(signupInvitation)
      .where(eq(signupInvitation.code, code.replace("-", "")));
    expect(row?.email).toBe("ada@example.com");
  });

  it("issues a different code each time", async () => {
    const { deps } = await issuer();

    const codes = await Promise.all(
      Array.from({ length: 20 }, () => issueSignupInvitation(deps, {})),
    );

    expect(new Set(codes.map(({ code }) => code)).size).toBe(20);
  });

  it("stores the invitation and says so when the mailer cannot send it, without logging the code", async () => {
    const { depsWithoutMethod, warnings, db } = await issuer();

    const { code } = await issueSignupInvitation(depsWithoutMethod, { email: "ada@example.com" });

    expect(warnings).toHaveLength(1);
    expect(warnings[0]).not.toContain(code);
    expect(await db.select().from(signupInvitation)).toHaveLength(1);
  });
});
