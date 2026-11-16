import { relations, sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { organization, user } from "{{SCOPE}}/auth/schema";

// This file imports nothing of the project but the auth tables it points at, and nothing in it runs
// when it loads: `packages/db`'s schema barrel re-exports it, so an import back into the project
// would make a module cycle.

const createdAtMs = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .default(sql`(cast(unixepoch('subsecond') * 1000 as integer))`)
    .notNull();

export const medias = sqliteTable("medias", {
  id: text("id")
    .$defaultFn(() => crypto.randomUUID())
    .primaryKey(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  key: text("key").notNull(),
  size: integer("size").notNull(),
  mimeType: text("mime_type").notNull(),
  authorId: text("author_id").references(() => user.id),
  organizationId: text("organization_id").references(() => organization.id, {
    onDelete: "cascade",
  }),
  createdAt: createdAtMs(),
});

export const mediasRelations = relations(medias, ({ one }) => ({
  author: one(user, { fields: [medias.authorId], references: [user.id] }),
  organization: one(organization, {
    fields: [medias.organizationId],
    references: [organization.id],
  }),
}));
