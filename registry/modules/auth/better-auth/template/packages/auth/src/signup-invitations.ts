import { and, eq, gt, isNull, sql } from "drizzle-orm";
import type { AuthDatabase, AuthLogger } from "./auth.config";
import type { AuthMailer } from "./mailer";
import * as schema from "./schema";

const { invitation, organization, signupInvitation } = schema;

/** How long a signup code can be used. */
export const SIGNUP_INVITATION_EXPIRES_IN = 7 * 24 * 60 * 60 * 1000; // 7 days, in milliseconds

/** No 0, 1, I or O: a code is read out and typed by hand. 32 characters, so a random byte maps onto it without bias. */
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const CODE_LENGTH = 8;

function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

/** The code as it is stored: upper case, without the dash or the spaces a person adds. */
export function normalizeSignupCode(input: string): string {
  return input.replace(/[\s-]/g, "").toUpperCase();
}

/** The code as it is shown: `XXXX-XXXX`. */
function formatSignupCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** The `inviteCode` a request carries in its body, as it was sent: `undefined` when there is none. */
export function inviteCodeOf(context: { body?: unknown } | null): unknown {
  const body = context?.body;
  return typeof body === "object" && body !== null && "inviteCode" in body
    ? body.inviteCode
    : undefined;
}

/**
 * Whether a sign-up for this email may create an account. A code that was given decides alone: an
 * invalid one is refused even when an organization invitation would have let the email in. Without
 * a code, a pending organization invitation, on an organization that is not soft-deleted, does.
 * `code` is the signup code that was used, to be consumed once the account exists.
 */
export async function resolveSignupGrant(
  db: AuthDatabase,
  { email, inviteCode }: { email: string; inviteCode: unknown },
): Promise<{ allowed: false } | { allowed: true; code: string | null }> {
  const now = new Date();
  const lowered = email.toLowerCase();

  if (inviteCode !== undefined && inviteCode !== null && inviteCode !== "") {
    if (typeof inviteCode !== "string") return { allowed: false };
    const code = normalizeSignupCode(inviteCode);
    const [found] = await db
      .select({ email: signupInvitation.email })
      .from(signupInvitation)
      .where(
        and(
          eq(signupInvitation.code, code),
          eq(signupInvitation.status, "pending"),
          gt(signupInvitation.expiresAt, now),
        ),
      );
    if (found === undefined) return { allowed: false };
    if (found.email !== null && found.email.toLowerCase() !== lowered) return { allowed: false };
    return { allowed: true, code };
  }

  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        eq(invitation.status, "pending"),
        sql`lower(${invitation.email}) = ${lowered}`,
        gt(invitation.expiresAt, now),
        isNull(organization.deletedAt),
      ),
    )
    .limit(1);
  return pending === undefined ? { allowed: false } : { allowed: true, code: null };
}

/**
 * Marks a signup code as used by this user. One statement that still requires `pending`, so that of
 * two sign-ups racing on one code, the second finds it taken and consumes nothing.
 */
export async function consumeSignupCode(
  db: AuthDatabase,
  code: string,
  userId: string,
): Promise<void> {
  await db
    .update(signupInvitation)
    .set({ status: "accepted", consumedByUserId: userId })
    .where(
      and(
        eq(signupInvitation.code, normalizeSignupCode(code)),
        eq(signupInvitation.status, "pending"),
      ),
    );
}

export type IssueSignupInvitationDeps = {
  db: AuthDatabase;
  mailer: AuthMailer;
  /** The origin of the front-end, whose `/auth/register` page takes the code (`SPA_URL`). */
  appURL: string;
  logger: Pick<AuthLogger, "warn">;
};

/**
 * Issues a signup invitation, bound to `email` when one is given and open to anyone who holds the
 * code otherwise, and returns the code as it is shown with the link that carries it. With an email,
 * the link is also sent through the mailer; a mailer without `sendSignupInvitation` leaves the
 * invitation stored and the caller holds the code.
 */
export async function issueSignupInvitation(
  { db, mailer, appURL, logger }: IssueSignupInvitationDeps,
  { email }: { email?: string },
): Promise<{ code: string; url: string }> {
  const to = email?.trim().toLowerCase();
  const stored = generateCode();
  await db.insert(signupInvitation).values({
    id: crypto.randomUUID(),
    code: stored,
    email: to || null,
    expiresAt: new Date(Date.now() + SIGNUP_INVITATION_EXPIRES_IN),
  });

  const code = formatSignupCode(stored);
  const url = new URL("/auth/register", appURL);
  url.searchParams.set("code", code);
  const issued = { code, url: url.toString() };

  if (to) {
    if (mailer.sendSignupInvitation === undefined) {
      logger.warn("The mailer has no sendSignupInvitation: the signup invitation was not sent", {
        scope: "auth",
        event: "email_not_sent",
        kind: "signup_invitation",
      });
    } else {
      await mailer.sendSignupInvitation({ to, ...issued });
    }
  }
  return issued;
}
