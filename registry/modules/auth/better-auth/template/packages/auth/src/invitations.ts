import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";
import type { AuthDatabase } from "./auth.config";
import * as schema from "./schema";

const { invitation, organization, user } = schema;

/**
 * Turns the pending invitations addressed to this user into memberships, and returns the
 * organization of the most recent one accepted (null when none was). D1 has no transaction, so
 * each step is safe to run twice: a user who already is a member gets no second row, and the
 * invitation is still marked accepted. A sign-in that dies half way is finished by the next one.
 */
export async function acceptPendingInvitations(
  db: AuthDatabase,
  userId: string,
): Promise<string | null> {
  const [found] = await db
    .select({ email: user.email, emailVerified: user.emailVerified })
    .from(user)
    .where(eq(user.id, userId));
  // The session exists only once the address is verified while `requireEmailVerification` is on;
  // this keeps it true if a project turns that off, as an invitation proves the address is theirs.
  if (found === undefined || !found.emailVerified) return null;

  const pending = await db
    .select({
      id: invitation.id,
      organizationId: invitation.organizationId,
      role: invitation.role,
    })
    .from(invitation)
    .innerJoin(organization, eq(invitation.organizationId, organization.id))
    .where(
      and(
        eq(invitation.status, "pending"),
        sql`lower(${invitation.email}) = lower(${found.email})`,
        gt(invitation.expiresAt, new Date()),
        isNull(organization.deletedAt),
      ),
    )
    .orderBy(asc(invitation.createdAt));

  let accepted: string | null = null;
  for (const { id, organizationId, role } of pending) {
    // One statement, so that two sign-ins of the same user cannot both pass the check: `member` has
    // no unique index on (user, organization), and a read followed by an insert would let both in.
    await db.run(sql`
      INSERT INTO member (id, organization_id, user_id, role, created_at)
      SELECT ${crypto.randomUUID()}, ${organizationId}, ${userId}, ${role ?? "member"}, ${Date.now()}
      WHERE NOT EXISTS (
        SELECT 1 FROM member WHERE user_id = ${userId} AND organization_id = ${organizationId}
      )
    `);
    await db.update(invitation).set({ status: "accepted" }).where(eq(invitation.id, id));
    accepted = organizationId;
  }
  return accepted;
}
