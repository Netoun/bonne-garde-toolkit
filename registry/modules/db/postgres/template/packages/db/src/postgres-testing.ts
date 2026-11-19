import { PGlite } from "@electric-sql/pglite";
import { PGLiteSocketServer } from "@electric-sql/pglite-socket";

/** A real Postgres engine for tests, with no Docker: `url` is what `DATABASE_URL` takes, `stop` closes it. */
export type TestPostgres = { url: string; stop: () => Promise<void> };

/**
 * A fresh in-memory PGlite served over the Postgres wire protocol on a free port of `127.0.0.1`, so the
 * code under test uses the same postgres-js client it uses in production. PGlite serves one connection
 * at a time: give the client `{ max: 1 }` when it runs several queries at once.
 */
export async function startTestPostgres(): Promise<TestPostgres> {
  const db = await PGlite.create();
  const server = new PGLiteSocketServer({ db, host: "127.0.0.1", port: 0 });
  await server.start();
  return {
    url: `postgres://postgres:postgres@${server.getServerConn()}/postgres`,
    stop: async () => {
      await server.stop();
      await db.close();
    },
  };
}
