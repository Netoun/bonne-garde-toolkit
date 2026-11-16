import { readFile, stat } from "node:fs/promises";

/**
 * What a project path holds: nothing, a regular file, or something else. A file is read once, as
 * its bytes and as text; the text is lossy for a file that is not UTF-8, so a binary file is
 * compared by its bytes.
 */
export type Disk =
  | { kind: "absent" }
  | { kind: "file"; content: string; bytes: Uint8Array }
  | { kind: "other" };

export function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

export async function readDisk(path: string): Promise<Disk> {
  try {
    const info = await stat(path);
    if (!info.isFile()) {
      return { kind: "other" };
    }
    const bytes = await readFile(path);
    return { kind: "file", content: bytes.toString("utf8"), bytes };
  } catch (error) {
    if (isMissing(error)) {
      return { kind: "absent" };
    }
    throw error;
  }
}
