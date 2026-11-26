import { describe, it, expect } from "vite-plus/test";
import { sql } from "drizzle-orm";
import { createTestDb } from "{{SCOPE}}/db/testing";
import { writeWithAudit } from "./record";
import { auditLog } from "./schema";
import { createTestAuditDb } from "./testing";
import { APPEND_ONLY_MESSAGE, ensureAuditTriggers } from "./triggers";

// The database is the one the project's db module installs: the fake D1 on the d1 variant, libsql on
// the dockerfile one. Golden runs this file on both.

/** Every message of an error and its causes: Drizzle wraps the driver's error, which carries the trigger's. */
function messages(error: unknown): string {
  const parts: string[] = [];
  for (let current = error; current instanceof Error; current = current.cause) {
    parts.push(current.message);
  }
  return parts.join(" | ");
}

async function failure(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return messages(error);
  }
  throw new Error("expected the statement to fail");
}

async function seeded() {
  const db = await createTestAuditDb();
  await writeWithAudit(
    db,
    [db.insert(auditLog).values({ id: "x", action: "seed", entityType: "t" })],
    {
      action: "note.create",
      entityType: "note",
    },
  );
  return db;
}

describe("ensureAuditTriggers", () => {
  it("refuses UPDATE on audit_log", async () => {
    const db = await seeded();

    expect(await failure(() => db.run(sql`update audit_log set action = 'forged'`))).toContain(
      APPEND_ONLY_MESSAGE,
    );
  });

  it("refuses DELETE on audit_log", async () => {
    const db = await seeded();

    expect(await failure(() => db.run(sql`delete from audit_log`))).toContain(APPEND_ONLY_MESSAGE);
    expect(await db.select().from(auditLog)).toHaveLength(2);
  });

  it("is harmless to call twice", async () => {
    const db = await createTestAuditDb();

    await ensureAuditTriggers(db);
    await ensureAuditTriggers(db);

    const triggers = await db.all<{ name: string }>(
      sql`select name from sqlite_master where type = 'trigger' order by name`,
    );
    expect(triggers.map(({ name }) => name)).toEqual([
      "audit_log_no_delete",
      "audit_log_no_update",
    ]);
  });

  it("is applied by the first write, so a database that was not prepared is protected too", async () => {
    const db = await createTestDb({ auditLog });

    await writeWithAudit(
      db,
      [db.insert(auditLog).values({ id: "x", action: "seed", entityType: "t" })],
      {
        action: "note.create",
        entityType: "note",
      },
    );

    expect(await failure(() => db.run(sql`delete from audit_log`))).toContain(APPEND_ONLY_MESSAGE);
  });
});
