import { getTableName, is } from "drizzle-orm";
import { getTableConfig, SQLiteTable } from "drizzle-orm/sqlite-core";
import * as barrel from "./schema";

/**
 * The tables of `schema`, each before the tables it points at: a foreign key refuses to delete a row
 * that another still references, so the children go first. A reference to itself or to a table the
 * schema does not hold is not an ordering. Two tables that point at each other have no order, and
 * the error names them.
 */
export function resetOrder(schema: Record<string, unknown> = barrel): string[] {
  const tables = Object.values(schema).filter((value) => is(value, SQLiteTable));
  const names = new Set(tables.map(getTableName));
  // Each table, with the tables that point at it: the ones that have to be emptied before it.
  const children = new Map<string, Set<string>>([...names].map((name) => [name, new Set()]));
  for (const table of tables) {
    for (const foreignKey of getTableConfig(table).foreignKeys) {
      const parent = getTableName(foreignKey.reference().foreignTable);
      if (parent !== getTableName(table) && names.has(parent)) {
        children.get(parent)?.add(getTableName(table));
      }
    }
  }

  const order: string[] = [];
  let remaining = [...names].sort();
  while (remaining.length > 0) {
    const ready = remaining.filter((name) =>
      [...(children.get(name) ?? [])].every((child) => order.includes(child)),
    );
    if (ready.length === 0) {
      throw new Error(
        `these tables point at each other, so no order of deletes empties them: ${remaining.join(", ")}`,
      );
    }
    order.push(...ready);
    remaining = remaining.filter((name) => !ready.includes(name));
  }
  return order;
}

/** What `db:reset` runs: every row of every table of the schema barrel, children before parents. */
export function resetStatements(schema: Record<string, unknown> = barrel): string[] {
  return resetOrder(schema).map((table) => `DELETE FROM "${table}";`);
}

/** `apps/api`, where `wrangler.jsonc` and the local D1 state are. */
const API_DIRECTORY = new URL("../../../apps/api/", import.meta.url).pathname;

async function wrangler(...args: string[]): Promise<void> {
  const wranglerProcess = Bun.spawn(["bunx", "wrangler", ...args], {
    cwd: API_DIRECTORY,
    stdin: "ignore",
    stdout: "inherit",
    stderr: "inherit",
    env: { ...Bun.env, WRANGLER_SEND_METRICS: "false" },
  });
  if ((await wranglerProcess.exited) !== 0) {
    throw new Error(`wrangler ${args.join(" ")} failed`);
  }
}

/**
 * `bun run db:reset`: empties every table of the schema barrel in the local D1 the binding `DB` names in
 * `apps/api/wrangler.jsonc`, whichever module owns it. It runs no migration, and the D1 migrations table
 * is not in the barrel, so what is applied stays applied. Seeding is the module's, after this.
 */
async function main(): Promise<void> {
  const tables = resetOrder();
  if (tables.length === 0) {
    await Bun.write(Bun.stdout, "The schema barrel exports no table: nothing to empty\n");
    return;
  }
  await wrangler("d1", "execute", "DB", "--local", "--command", resetStatements().join(" "));
  await Bun.write(Bun.stdout, `Emptied: ${tables.join(", ")}\n`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    await Bun.write(Bun.stderr, `${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
