import { createTestDb } from "{{SCOPE}}/db/testing";
import { auditLog } from "./schema";
import { ensureAuditTriggers } from "./triggers";

/**
 * A fresh in-memory database, the one the project's db is (D1 or libsql), with `audit_log`, the
 * tables a test brings, and the append-only triggers applied.
 */
export async function createTestAuditDb<TTables extends Record<string, unknown> = {}>(
  tables?: TTables,
) {
  const db = await createTestDb({ auditLog, ...tables });
  await ensureAuditTriggers(db);
  return db;
}
