import { and, asc, eq, gt, lte } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import * as schema from "./schema";

const { waitlistEntry, waitlistJoin } = schema;

/** A Drizzle SQLite database that has the launch tables: libsql in the API, and the test database. */
export type LaunchDatabase = BaseSQLiteDatabase<"sync" | "async", unknown, typeof schema>;

/** The window the join limit counts in. */
export const HOUR_MS = 60 * 60 * 1000;

/** The shape of an address worth keeping: one `@`, a dot in the domain, no space. Deliverability is not checked. */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX_LENGTH = 254;

/** The address as it is stored (trimmed, lowercased), or null when it is not an email address. */
export function normalizeEmail(input: string): string | null {
  const email = input.trim().toLowerCase();
  return email.length <= EMAIL_MAX_LENGTH && EMAIL.test(email) ? email : null;
}

export type JoinResult = { listed: true } | { listed: false; retryAfterSeconds: number };

/**
 * Lists `email` and records the join against `ip`. An address already listed keeps its row and still
 * counts as a join: the limit is on requests. Over `maxPerHour` joins for `ip` in the last hour, nothing
 * is written and the answer says how long until the oldest of them leaves the window.
 */
export async function joinWaitlist(
  db: LaunchDatabase,
  input: { email: string; ip: string; maxPerHour: number; now: number },
): Promise<JoinResult> {
  const { email, ip, maxPerHour, now } = input;
  const cutoff = new Date(now - HOUR_MS);

  // What left the window is no longer counted by anyone: dropped here, so the table stays small.
  await db.delete(waitlistJoin).where(lte(waitlistJoin.createdAt, cutoff));
  const recent = await db
    .select({ createdAt: waitlistJoin.createdAt })
    .from(waitlistJoin)
    .where(and(eq(waitlistJoin.ip, ip), gt(waitlistJoin.createdAt, cutoff)))
    .orderBy(asc(waitlistJoin.createdAt))
    .limit(maxPerHour);
  const oldest = recent[0];
  if (recent.length >= maxPerHour && oldest !== undefined) {
    const retryAfterSeconds = Math.ceil((oldest.createdAt.getTime() + HOUR_MS - now) / 1000);
    return { listed: false, retryAfterSeconds: Math.max(1, retryAfterSeconds) };
  }

  await db.insert(waitlistJoin).values({ ip, createdAt: new Date(now) });
  await db
    .insert(waitlistEntry)
    .values({ email })
    .onConflictDoNothing({ target: waitlistEntry.email });
  return { listed: true };
}
