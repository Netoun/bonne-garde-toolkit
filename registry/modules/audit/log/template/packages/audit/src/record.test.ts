import { describe, it, expect } from "vite-plus/test";
import { eq, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { writeWithAudit } from "./record";
import { auditLog } from "./schema";
import { createTestAuditDb } from "./testing";

const notes = sqliteTable("notes", {
  id: integer("id").primaryKey(),
  title: text("title").notNull().unique(),
});

async function setup() {
  const db = await createTestAuditDb({ notes });
  await db.run(
    sql`create table if not exists notes (id integer primary key, title text not null unique)`,
  );
  return db;
}

describe("writeWithAudit", () => {
  it("writes the row and one audit entry with the row before and after", async () => {
    const db = await setup();

    const id = await writeWithAudit(db, [db.insert(notes).values({ id: 1, title: "first" })], {
      organizationId: "org-1",
      actorId: "user-1",
      action: "note.create",
      entityType: "note",
      entityId: "1",
      before: null,
      after: { id: 1, title: "first" },
    });

    expect(await db.select().from(notes)).toEqual([{ id: 1, title: "first" }]);
    const entries = await db.select().from(auditLog);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      id,
      organizationId: "org-1",
      actorId: "user-1",
      action: "note.create",
      entityType: "note",
      entityId: "1",
      before: "null",
      after: JSON.stringify({ id: 1, title: "first" }),
    });
    expect(entries[0]?.createdAt).toBeInstanceOf(Date);
  });

  it("leaves before, after and the actor empty when the entry has none", async () => {
    const db = await setup();

    await writeWithAudit(db, [db.insert(notes).values({ id: 1, title: "first" })], {
      action: "note.create",
      entityType: "note",
    });

    const [entry] = await db.select().from(auditLog);
    expect(entry).toMatchObject({
      organizationId: null,
      actorId: null,
      entityId: null,
      before: null,
      after: null,
    });
  });

  it("writes every query of the batch and one entry", async () => {
    const db = await setup();
    await db.insert(notes).values({ id: 1, title: "first" });

    await writeWithAudit(
      db,
      [
        db.update(notes).set({ title: "renamed" }).where(eq(notes.id, 1)),
        db.insert(notes).values({ id: 2, title: "second" }),
      ],
      { action: "note.rename", entityType: "note", entityId: "1" },
    );

    expect((await db.select().from(notes)).map(({ title }) => title)).toEqual([
      "renamed",
      "second",
    ]);
    expect(await db.select().from(auditLog)).toHaveLength(1);
  });

  it("writes neither the row nor the entry when a write of the batch fails", async () => {
    const db = await setup();
    await db.insert(notes).values({ id: 1, title: "taken" });

    await expect(
      writeWithAudit(
        db,
        [
          db.insert(notes).values({ id: 2, title: "fine" }),
          db.insert(notes).values({ id: 3, title: "taken" }),
        ],
        { action: "note.create", entityType: "note" },
      ),
    ).rejects.toThrow();

    expect(await db.select().from(notes)).toEqual([{ id: 1, title: "taken" }]);
    expect(await db.select().from(auditLog)).toEqual([]);
  });
});
