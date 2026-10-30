import { describe, it, expect } from "bun:test";
import { Relations, SQL, getTableColumns, getTableName, is, type Column } from "drizzle-orm";
import { SQLiteSyncDialect, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as authSchema from "@acme/api/modules/db/schemas/db.auth-schema";
import { createAuth } from "./auth.config";

// `db.auth-schema.ts` is what `bun run auth:generate` rewrites, from the schema Better Auth
// resolves out of the options in `auth.config.ts`. A column that exists in the Drizzle file but not
// in that resolved schema is silently dropped by the next regeneration, and the migration that
// follows deletes its data.
describe("auth schema", () => {
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

  it("keeps db.auth-schema.ts to what the generator emits, tables and relations", () => {
    // Anything else in that file, such as an aggregate object, is overwritten by `auth:generate`
    // while the modules that import it still expect it. Callers use `import * as authSchema`.
    const handWritten = Object.entries(authSchema).filter(
      ([, value]) => !is(value, SQLiteTable) && !is(value, Relations),
    );

    expect(handWritten.map(([name]) => name)).toEqual([]);
  });

  it("keeps the SQLite default of every date column Better Auth defaults to now", async () => {
    // The CLI emits `.default(sql\`(cast(unixepoch('subsecond') ...))\`)` only when
    // `defaultValue.toString()` contains "new Date()", and Bun prints that function as
    // `() => new Date`. Under `bunx --bun` it drops every one of these defaults without an error,
    // and `db:generate` then rebuilds five tables without them. The script stays on `bunx`, which
    // honors the CLI's node shebang.
    const { tables } = await createAuth().$context;
    const dialect = new SQLiteSyncDialect();
    const checked: string[] = [];
    const withoutDefault: string[] = [];

    for (const table of Object.values(authSchema).filter((value) => is(value, SQLiteTable))) {
      const model = getTableName(table);
      const columns: Record<string, Column> = getTableColumns(table);

      for (const [name, field] of Object.entries(tables[model]?.fields ?? {})) {
        if (field.type !== "date" || typeof field.defaultValue !== "function") continue;

        const column = columns[name]?.default;
        const expression = is(column, SQL) ? dialect.sqlToQuery(column).sql : "";
        checked.push(`${model}.${name}`);
        if (!expression.includes("unixepoch('subsecond')")) withoutDefault.push(`${model}.${name}`);
      }
    }

    expect(checked).toContain("user.createdAt");
    expect(withoutDefault).toEqual([]);
  });
});
