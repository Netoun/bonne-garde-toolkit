/// <reference types="@cloudflare/workers-types" />
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { drizzle } from "drizzle-orm/d1";
import { generateSQLiteDrizzleJson, generateSQLiteMigration } from "drizzle-kit/api";
import * as barrel from "./schema";

/** The SQL that creates every table of `schema`, from nothing: what `db:generate` writes for a first migration. */
async function createStatements(schema: Record<string, unknown>): Promise<string[]> {
  return generateSQLiteMigration(
    await generateSQLiteDrizzleJson({}),
    await generateSQLiteDrizzleJson(schema),
  );
}

/** A value bound to a statement, as D1 binds it: a boolean is 1 or 0, and `undefined` is refused. */
function bound(value: unknown): SQLInputValue {
  if (
    value === null ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    typeof value === "string"
  ) {
    return value;
  }
  if (typeof value === "boolean") {
    return value ? 1 : 0;
  }
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    // A copy of the bytes it views, on a buffer of their own, which is what `node:sqlite` binds.
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength).slice();
  }
  throw new TypeError(`D1 cannot bind a value of type ${typeof value}`);
}

function meta(changes = 0, lastRowId = 0): D1Meta & Record<string, unknown> {
  return {
    duration: 0,
    size_after: 0,
    rows_read: 0,
    rows_written: changes,
    last_row_id: lastRowId,
    changed_db: changes > 0,
    changes,
  };
}

/** A D1 statement over `node:sqlite`: what Drizzle's D1 driver calls, `bind` then `all`, `raw` or `run`. */
class SqliteStatement implements D1PreparedStatement {
  readonly #sqlite: DatabaseSync;
  readonly #query: string;
  readonly #values: SQLInputValue[];

  constructor(sqlite: DatabaseSync, query: string, values: SQLInputValue[] = []) {
    this.#sqlite = sqlite;
    this.#query = query;
    this.#values = values;
  }

  bind(...values: unknown[]): D1PreparedStatement {
    return new SqliteStatement(this.#sqlite, this.#query, values.map(bound));
  }

  /** The rows as the caller types them, which is all D1 does with them too. */
  #rows<T>(arrays: boolean): T[] {
    const statement = this.#sqlite.prepare(this.#query);
    statement.setReturnArrays(arrays);
    const rows: unknown[] = statement.all(...this.#values);
    return rows as T[];
  }

  async all<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    return { success: true, meta: meta(), results: this.#rows<T>(false) };
  }

  async run<T = Record<string, unknown>>(): Promise<D1Result<T>> {
    const { changes, lastInsertRowid } = this.#sqlite.prepare(this.#query).run(...this.#values);
    return { success: true, meta: meta(Number(changes), Number(lastInsertRowid)), results: [] };
  }

  first<T = unknown>(column: string): Promise<T | null>;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  async first<T>(column?: string): Promise<T | null> {
    const [row] = this.#rows<Record<string, unknown>>(false);
    const value: unknown = column === undefined ? row : row?.[column];
    return (value ?? null) as T | null;
  }

  raw<T = unknown[]>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
  raw<T = unknown[]>(options?: { columnNames?: false }): Promise<T[]>;
  async raw<T = unknown[]>(options?: { columnNames?: boolean }): Promise<T[] | [string[], ...T[]]> {
    const rows = this.#rows<T>(true);
    if (options?.columnNames !== true) {
      return rows;
    }
    const names = this.#sqlite
      .prepare(this.#query)
      .columns()
      .map(({ name }) => name);
    return [names, ...rows];
  }
}

/**
 * D1 over an in-memory `node:sqlite` database: SQLite, which is what D1 is, with foreign keys enforced
 * as D1 enforces them. A batch is one transaction, as on D1. It has no sessions and no dump.
 */
class SqliteD1 implements D1Database {
  readonly #sqlite = new DatabaseSync(":memory:");

  prepare(query: string): D1PreparedStatement {
    return new SqliteStatement(this.#sqlite, query);
  }

  async batch<T = unknown>(statements: D1PreparedStatement[]): Promise<D1Result<T>[]> {
    this.#sqlite.exec("BEGIN");
    try {
      const results: D1Result<T>[] = [];
      for (const statement of statements) {
        results.push(await statement.all<T>());
      }
      this.#sqlite.exec("COMMIT");
      return results;
    } catch (error) {
      this.#sqlite.exec("ROLLBACK");
      throw error;
    }
  }

  async exec(query: string): Promise<D1ExecResult> {
    this.#sqlite.exec(query);
    return { count: query.split(";").filter((part) => part.trim() !== "").length, duration: 0 };
  }

  withSession(): never {
    throw new Error("The test database has no sessions: D1's read replication is not there");
  }

  dump(): never {
    throw new Error("The test database has no dump");
  }
}

/**
 * A fresh in-memory D1 with the tables of the project's schema barrel, or of `schema` when a test
 * brings its own, behind the Drizzle driver the API uses. The tables come from the schema and not
 * from the migrations, so a test does not wait for `vp run db:generate`.
 */
export async function createTestDb(): Promise<ReturnType<typeof drizzle<typeof barrel>>>;
export async function createTestDb<TSchema extends Record<string, unknown>>(
  schema: TSchema,
): Promise<ReturnType<typeof drizzle<TSchema>>>;
export async function createTestDb(schema: Record<string, unknown> = barrel) {
  const d1: D1Database = new SqliteD1();
  for (const statement of await createStatements(schema)) {
    await d1.exec(statement);
  }
  return drizzle(d1, { schema });
}

/** The database `createTestDb()` returns for the barrel, with a `query` of its tables. */
export type TestDb = ReturnType<typeof drizzle<typeof barrel>>;
