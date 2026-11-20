import { lstat, mkdir, readFile, realpath, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
import { R2Error, validateKey } from "./storage";

/** The directory of the files, under `DATA_DIR`. */
export const MEDIA_DIR = "media";
// The default of `provider/dockerfile` and `db/libsql`: the media sit where the database and the secrets do.
const DEFAULT_DATA_DIR = ".data";

/**
 * What the media service needs of where the files live: the three calls it makes, over the bytes of a
 * file. The content type is the `medias` row's, so the bucket does not keep one.
 */
export interface MediaBucket {
  put(key: string, bytes: Uint8Array): Promise<void>;
  /** The bytes under `key`, or `null` when there are none. */
  get(key: string): Promise<Uint8Array<ArrayBuffer> | null>;
  /** Removes the file under `key`; a missing file is not an error. */
  delete(key: string): Promise<void>;
}

function hasCode(error: unknown, ...codes: string[]): boolean {
  return error instanceof Error && "code" in error && codes.includes(String(error.code));
}

/**
 * Where `key` lives under `base`, the real path of the media directory. The key is validated first
 * (no `..`, no absolute key, no control character), and then no component of the path that exists may
 * be a symbolic link: a link inside the directory would lead a read or a write out of it.
 */
async function locate(base: string, key: string): Promise<string> {
  validateKey(key);
  let current = base;
  for (const segment of key.split("/")) {
    current = join(current, segment);
    const found = await lstat(current).catch((error: unknown) => {
      if (hasCode(error, "ENOENT", "ENOTDIR")) return null;
      throw error;
    });
    if (found === null) break;
    if (found.isSymbolicLink()) throw new R2Error("Invalid media key", "INVALID_KEY");
  }
  const path = resolve(base, key);
  if (!path.startsWith(base + sep)) throw new R2Error("Invalid media key", "INVALID_KEY");
  return path;
}

/** The real path of `root`, or `null` when it does not exist yet. */
async function existingRoot(root: string): Promise<string | null> {
  return realpath(root).catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return null;
    throw error;
  });
}

/** A bucket over the directory `root`: one file per key, at `<root>/<key>`. Created on the first write. */
export function createFsBucket(root: string): MediaBucket {
  return {
    async put(key, bytes) {
      await mkdir(root, { recursive: true });
      const base = await realpath(root);
      const path = await locate(base, key);
      await mkdir(dirname(path), { recursive: true });
      try {
        // `wx` fails on a file that exists, and on a link, dangling or not: nothing is overwritten.
        await writeFile(path, bytes, { flag: "wx" });
      } catch (error) {
        // A half-written file is not kept, but a file that was already there is not ours to remove.
        if (!hasCode(error, "EEXIST")) await unlink(path).catch(() => undefined);
        throw error;
      }
    },
    async get(key) {
      const base = await existingRoot(root);
      if (base === null) {
        validateKey(key);
        return null;
      }
      const path = await locate(base, key);
      try {
        return new Uint8Array(await readFile(path));
      } catch (error) {
        // Absent, or a directory (a key that stops at a folder): nothing is served.
        if (hasCode(error, "ENOENT", "ENOTDIR", "EISDIR")) return null;
        throw error;
      }
    },
    async delete(key) {
      const base = await existingRoot(root);
      if (base === null) {
        validateKey(key);
        return;
      }
      try {
        await unlink(await locate(base, key));
      } catch (error) {
        if (!hasCode(error, "ENOENT", "ENOTDIR")) throw error;
      }
    },
  };
}

/**
 * The bucket of the runtime the code runs on: `<DATA_DIR>/media`, read through the provider's
 * `readRuntimeEnv`, with the default `DATA_DIR` the database uses.
 */
export async function readBucket(
  source?: Record<string, string | undefined>,
): Promise<MediaBucket> {
  const { DATA_DIR } = await readRuntimeEnv(source);
  const dataDir = typeof DATA_DIR === "string" && DATA_DIR !== "" ? DATA_DIR : DEFAULT_DATA_DIR;
  return createFsBucket(resolve(dataDir, MEDIA_DIR));
}
