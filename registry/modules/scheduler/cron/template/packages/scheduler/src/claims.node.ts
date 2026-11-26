/**
 * The claims on Node: a libsql file of its own under `DATA_DIR`, `scheduler.sqlite`, one table. Never
 * `db.sqlite`: this module has no `db` peer, and a project on `db/postgres` must run.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
import type { ClaimStore } from "./dispatch";

/** The file name under `DATA_DIR`. */
export const CLAIMS_FILE = "scheduler.sqlite";
// The default of `provider/dockerfile`, where `db.sqlite` and the volume are.
const DEFAULT_DATA_DIR = ".data";

/**
 * One statement, so the answer comes from the database and never from a read followed by a write: the
 * row is inserted unless the same slot exists already (once per slot) or a run of that schedule holds
 * a lease that has not passed (the overlap guard). The claim is won if and only if a row went in.
 */
const CLAIM = `insert into schedule_runs (name, slot, status, started_at, lease_until)
select ?1, ?2, 'running', ?3, ?4
where not exists (
  select 1 from schedule_runs where name = ?1 and status = 'running' and lease_until > ?3
)
on conflict (name, slot) do nothing`;

/** Opens `<dataDir>/scheduler.sqlite`, creating the directory and the table when they are missing. */
export async function openClaimStore(dataDir: string): Promise<ClaimStore & { close(): void }> {
  await mkdir(dataDir, { recursive: true });
  const client = createClient({ url: `file:${join(dataDir, CLAIMS_FILE)}` });
  // Two connections on the file wait for each other instead of failing with SQLITE_BUSY.
  await client.execute("pragma busy_timeout = 5000");
  await client.execute(
    `create table if not exists schedule_runs (
      name text not null,
      slot text not null,
      status text not null,
      started_at integer not null,
      lease_until integer not null,
      finished_at integer,
      error text,
      primary key (name, slot)
    )`,
  );
  return {
    async claim({ name, slot, now, leaseMs }) {
      const { rowsAffected } = await client.execute({
        sql: CLAIM,
        args: [name, slot, now.getTime(), now.getTime() + leaseMs],
      });
      return rowsAffected === 1;
    },
    async finish({ name, slot }, outcome) {
      await client.execute({
        sql: "update schedule_runs set status = ?, finished_at = ?, error = ? where name = ? and slot = ?",
        args: [
          outcome.status,
          Date.now(),
          outcome.status === "failed" ? outcome.error : null,
          name,
          slot,
        ],
      });
    },
    close: () => client.close(),
  };
}

/**
 * The store over `DATA_DIR` (`.data` by default), opened by the first call: the promise is kept, so two
 * first calls at the same time open one file. The environment is read then, not when the driver loads.
 */
export function lazyClaimStore(source?: Record<string, string | undefined>): ClaimStore {
  let opened: Promise<ClaimStore> | undefined;
  const store = (): Promise<ClaimStore> => {
    opened ??= readRuntimeEnv(source)
      .then(({ DATA_DIR }) =>
        openClaimStore(
          typeof DATA_DIR === "string" && DATA_DIR !== "" ? DATA_DIR : DEFAULT_DATA_DIR,
        ),
      )
      .catch((error: unknown) => {
        opened = undefined;
        throw error;
      });
    return opened;
  };
  return {
    claim: async (claim) => (await store()).claim(claim),
    finish: async (claim, outcome) => (await store()).finish(claim, outcome),
  };
}
