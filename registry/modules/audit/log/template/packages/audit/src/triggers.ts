import { sql } from "drizzle-orm";
import type { DrizzleD1Database } from "drizzle-orm/d1";
import type { LibSQLDatabase } from "drizzle-orm/libsql";

/** The message of the error a trigger raises, which a caller can look for. */
export const APPEND_ONLY_MESSAGE = "audit_log is append-only";

/**
 * The SQL of the two triggers that make `audit_log` append-only. The same text runs on D1 and
 * libsql. `drizzle-kit generate` does not emit triggers, so `ensureAuditTriggers` applies them.
 */
export const AUDIT_TRIGGERS = [
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_update BEFORE UPDATE ON audit_log BEGIN SELECT RAISE(ABORT, '${APPEND_ONLY_MESSAGE}'); END;`,
  `CREATE TRIGGER IF NOT EXISTS audit_log_no_delete BEFORE DELETE ON audit_log BEGIN SELECT RAISE(ABORT, '${APPEND_ONLY_MESSAGE}'); END;`,
] as const;

/** A Drizzle database over D1 or libsql, whatever its schema: the two drivers `batch` and `run` alike. */
export type AuditDatabase =
  | DrizzleD1Database<Record<string, unknown>>
  | LibSQLDatabase<Record<string, unknown>>;

// One promise per underlying client (the D1 binding, the libsql client): a Worker builds a Drizzle
// object per request over the same binding, and a test builds a database of its own. `drizzle()`
// puts the client on `$client`; the type of `createDB`'s result does not name it.
const applied = new WeakMap<object, Promise<void>>();

/**
 * Applies the triggers once per process and database, before the first write. `IF NOT EXISTS` makes
 * it harmless to run again; a failure is not kept, so the next call tries again.
 */
export function ensureAuditTriggers(db: AuditDatabase): Promise<void> {
  const client: object =
    "$client" in db && typeof db.$client === "object" && db.$client !== null ? db.$client : db;
  let promise = applied.get(client);
  if (promise === undefined) {
    promise = (async () => {
      for (const trigger of AUDIT_TRIGGERS) {
        await db.run(sql.raw(trigger));
      }
    })().catch((error: unknown) => {
      applied.delete(client);
      throw error;
    });
    applied.set(client, promise);
  }
  return promise;
}
