import postgres, { type Sql } from "postgres";
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";

const UNBOUND = `DATABASE_URL is not set, so there is no Postgres to query. Set it in .env (.env.example holds the local one) and start the local database with \`vp run db:up\` in packages/db, or point it at your own Postgres.`;

/**
 * What stands in for the database where `DATABASE_URL` is missing: a client with no connection to make,
 * whose first query fails with a message naming the variable. The code that holds it (an Elysia app,
 * `/health` and every route that does not query) loads and answers without a database.
 */
const UNBOUND_CLIENT: Sql = postgres({
  socket: () => {
    throw new Error(UNBOUND);
  },
});

/** Whether `sql` is the client that fails with no `DATABASE_URL`, so a plugin can skip its migrations. */
export function isUnbound(sql: Sql): boolean {
  return sql === UNBOUND_CLIENT;
}

/** One client per URL. postgres-js opens no connection until the first query, so keeping one costs nothing. */
const clients = new Map<string, Sql>();

/**
 * The postgres-js client over `DATABASE_URL`: the same one on every call for one URL, two calls at the same
 * time included (nothing is awaited between the lookup and the store). With the variable blank or unset it
 * is the unbound client, not an error. `source` is the environment `readRuntimeEnv` reads.
 */
export async function readPostgres(source?: Record<string, string | undefined>): Promise<Sql> {
  const { DATABASE_URL } = await readRuntimeEnv(source);
  const url = typeof DATABASE_URL === "string" ? DATABASE_URL.trim() : "";
  if (url === "") {
    return UNBOUND_CLIENT;
  }
  let client = clients.get(url);
  if (client === undefined) {
    client = postgres(url);
    clients.set(url, client);
  }
  return client;
}
