import { readFile, stat } from "node:fs/promises";

/** What a project path holds: nothing, a regular file (read as text), or something else. */
export type Disk = { kind: "absent" } | { kind: "file"; content: string } | { kind: "other" };

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
    return info.isFile()
      ? { kind: "file", content: await readFile(path, "utf8") }
      : { kind: "other" };
  } catch (error) {
    if (isMissing(error)) {
      return { kind: "absent" };
    }
    throw error;
  }
}
