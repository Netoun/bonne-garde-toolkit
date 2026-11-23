/**
 * The state of the rooms on Node: a libsql file of its own under `DATA_DIR`, `realtime.sqlite`, one
 * table. Never `db.sqlite`: this module has no `db` peer, and a project on `db/postgres` must run.
 */
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { createClient } from "@libsql/client";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
import type { StateStore } from "./rooms";

/** The file name under `DATA_DIR`. */
export const STATE_FILE = "realtime.sqlite";
// The default of `provider/dockerfile`, where `db.sqlite` and the volume are.
const DEFAULT_DATA_DIR = ".data";

/** Opens `<dataDir>/realtime.sqlite`, creating the directory and the table when they are missing. */
export async function openStateStore(dataDir: string): Promise<StateStore & { close(): void }> {
  await mkdir(dataDir, { recursive: true });
  const client = createClient({ url: `file:${join(dataDir, STATE_FILE)}` });
  await client.execute(
    "create table if not exists realtime_room_state (room text not null, key text not null, value text not null, primary key (room, key))",
  );
  return {
    async get(room, key) {
      const { rows } = await client.execute({
        sql: "select value from realtime_room_state where room = ? and key = ?",
        args: [room, key],
      });
      return rows[0] === undefined ? undefined : String(rows[0].value);
    },
    async set(room, key, value) {
      await client.execute({
        sql: "insert into realtime_room_state (room, key, value) values (?, ?, ?) on conflict (room, key) do update set value = excluded.value",
        args: [room, key, value],
      });
    },
    async delete(room, key) {
      await client.execute({
        sql: "delete from realtime_room_state where room = ? and key = ?",
        args: [room, key],
      });
    },
    async list(room) {
      const { rows } = await client.execute({
        sql: "select key, value from realtime_room_state where room = ?",
        args: [room],
      });
      return Object.fromEntries(rows.map((row) => [String(row.key), String(row.value)]));
    },
    async clear(room) {
      await client.execute({ sql: "delete from realtime_room_state where room = ?", args: [room] });
    },
    close: () => client.close(),
  };
}

/**
 * The store over `DATA_DIR` (`.data` by default), opened by the first call: the promise is kept, so two
 * first calls at the same time open one file. The environment is read then, not when the driver loads.
 */
export function lazyStateStore(source?: Record<string, string | undefined>): StateStore {
  let opened: Promise<StateStore> | undefined;
  const store = (): Promise<StateStore> => {
    opened ??= readRuntimeEnv(source)
      .then(({ DATA_DIR }) =>
        openStateStore(
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
    get: async (room, key) => (await store()).get(room, key),
    set: async (room, key, value) => (await store()).set(room, key, value),
    delete: async (room, key) => (await store()).delete(room, key),
    list: async (room) => (await store()).list(room),
    clear: async (room) => (await store()).clear(room),
  };
}
