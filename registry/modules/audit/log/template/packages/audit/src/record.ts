import type { BatchItem } from "drizzle-orm/batch";
import { auditLog } from "./schema";
import { ensureAuditTriggers, type AuditDatabase } from "./triggers";

/** One entry of the log. `before` and `after` are stored as JSON. */
export type AuditEntry = {
  organizationId?: string | null;
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
};

/** The caller's write queries: Drizzle inserts, updates and deletes, not yet awaited. */
export type AuditWrites = readonly [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]];

function json(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

/**
 * Runs `writes` and the audit insert in one `db.batch`, which is one transaction on D1 and on
 * libsql: if any statement fails, nothing is written. Returns the id of the entry.
 */
export async function writeWithAudit(
  db: AuditDatabase,
  writes: AuditWrites,
  entry: AuditEntry,
): Promise<string> {
  await ensureAuditTriggers(db);
  const id = crypto.randomUUID();
  await db.batch([
    ...writes,
    db.insert(auditLog).values({
      id,
      organizationId: entry.organizationId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      before: json(entry.before),
      after: json(entry.after),
    }),
  ]);
  return id;
}
