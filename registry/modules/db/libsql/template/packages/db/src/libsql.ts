import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { createClient, type Client } from "@libsql/client";
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";

/** The file name under `DATA_DIR`. */
export const DATABASE_FILE = "db.sqlite";
// The default of `provider/dockerfile`: the database sits where its volume and secrets do.
const DEFAULT_DATA_DIR = ".data";

/** One client per file: the key is the path, so a process that reads one `DATA_DIR` opens one. */
const clients = new Map<string, Promise<Client>>();

async function open(path: string): Promise<Client> {
  await mkdir(dirname(path), { recursive: true });
  return createClient({ url: `file:${path}` });
}

/**
 * The libsql client over `<DATA_DIR>/db.sqlite`, opened on the first call with the directory created
 * when it is missing, and the same one on every call after. The promise is kept, not the client, so
 * two first calls at the same time open one. `source` is the environment `readRuntimeEnv` reads.
 */
export async function readLibsql(source?: Record<string, string | undefined>): Promise<Client> {
  const { DATA_DIR } = await readRuntimeEnv(source);
  const path = join(
    typeof DATA_DIR === "string" && DATA_DIR !== "" ? DATA_DIR : DEFAULT_DATA_DIR,
    DATABASE_FILE,
  );
  let client = clients.get(path);
  if (client === undefined) {
    client = open(path).catch((error: unknown) => {
      clients.delete(path);
      throw error;
    });
    clients.set(path, client);
  }
  return client;
}
