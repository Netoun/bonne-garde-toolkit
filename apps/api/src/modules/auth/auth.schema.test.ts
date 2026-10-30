import { describe, it, expect } from "bun:test";
import { getTableColumns, getTableName, is } from "drizzle-orm";
import { SQLiteTable } from "drizzle-orm/sqlite-core";
import { authSchema } from "@acme/api/modules/db/schemas/db.auth-schema";
import { createAuth } from "./auth.config";

// `db.auth-schema.ts` is what `bun run auth:generate` rewrites, from the schema Better Auth
// resolves out of the options in `auth.config.ts`. A column that exists in the Drizzle file but not
// in that resolved schema is silently dropped by the next regeneration, and the migration that
// follows deletes its data.
describe("createAuth schema", () => {
  it("declares organization.deletedAt and organization.settings, which the auth module reads", async () => {
    const { tables } = await createAuth().$context;

    expect(tables.organization?.fields.deletedAt).toMatchObject({
      type: "date",
      required: false,
      // Soft delete is server-side: a client must not set it through `organization.create` or
      // `organization.update`, which accept every declared field unless `input` is false.
      input: false,
    });
    expect(tables.organization?.fields.settings).toMatchObject({
      type: "json",
      required: false,
      input: false,
    });
  });

  it("declares every column of every Drizzle auth table, with the same nullability", async () => {
    const { tables } = await createAuth().$context;

    const drizzleTables = Object.values(authSchema).filter((value) => is(value, SQLiteTable));
    const drizzleNames: string[] = drizzleTables.map(getTableName);
    expect(drizzleNames.toSorted()).toEqual(Object.keys(tables).toSorted());

    for (const table of drizzleTables) {
      const resolved = tables[getTableName(table)];
      const columns = getTableColumns(table);
      const { id, ...columnsWithoutId } = columns;

      expect(id).toBeDefined();
      expect(Object.keys(columnsWithoutId).toSorted()).toEqual(
        Object.keys(resolved?.fields ?? {}).toSorted(),
      );
      for (const [name, column] of Object.entries(columnsWithoutId)) {
        expect([getTableName(table), name, column.notNull]).toEqual([
          getTableName(table),
          name,
          resolved?.fields[name]?.required !== false,
        ]);
      }
    }
  });
});
