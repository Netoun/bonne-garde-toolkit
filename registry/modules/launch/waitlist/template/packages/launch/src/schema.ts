import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
import { sql } from "drizzle-orm";

// This file imports nothing of the project and nothing in it runs when it loads: `packages/db`'s
// schema barrel re-exports it, so an import back into the project would make a module cycle.

const createdAtMs = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

/** Someone on the waiting list: one row per address, lowercased. `invitedAt` is set once they are let in. */
export const waitlistEntry = sqliteTable("waitlist_entry", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  email: text("email").notNull().unique(),
  createdAt: createdAtMs(),
  invitedAt: integer("invited_at", { mode: "timestamp_ms" }),
});

/** One accepted join, by client address: what the hourly limit counts. A refused request leaves no row. */
export const waitlistJoin = sqliteTable(
  "waitlist_join",
  {
    id: text("id")
      .$defaultFn(() => crypto.randomUUID())
      .primaryKey(),
    ip: text("ip").notNull(),
    createdAt: createdAtMs(),
  },
  (table) => [index("waitlist_join_ip_created_at_idx").on(table.ip, table.createdAt)],
);
