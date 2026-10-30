import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** A file to put on disk: an absolute path and what it will hold. */
export type StagedFile = { path: string; content: string };

type Undo = () => Promise<void>;

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

/** What a path holds now: its bytes and mode, or `null` when nothing is there. */
async function priorState(path: string): Promise<{ bytes: Buffer; mode: number } | null> {
  try {
    const [bytes, info] = await Promise.all([readFile(path), stat(path)]);
    return { bytes, mode: info.mode & 0o777 };
  } catch (error) {
    if (isMissing(error)) {
      return null;
    }
    throw error;
  }
}

async function place(file: StagedFile, index: number, undo: Undo[]): Promise<void> {
  const created = await mkdir(dirname(file.path), { recursive: true });
  if (created !== undefined) {
    undo.push(() => rm(created, { recursive: true, force: true }));
  }
  const prior = await priorState(file.path);

  // The content goes to a sibling first and is renamed into place, so a target is either what it
  // was or what it is meant to be, never half-written.
  const temp = `${file.path}.${process.pid}.${index}.tmp`;
  undo.push(() => rm(temp, { force: true }));
  await writeFile(temp, file.content, "utf8");
  if (prior !== null) {
    await chmod(temp, prior.mode);
  }
  await rename(temp, file.path);

  undo.push(
    prior === null
      ? () => rm(file.path, { force: true })
      : () => writeFile(file.path, prior.bytes, { mode: prior.mode }),
  );
}

/**
 * Spec 060 "Staging": writes every file or none. On any error the files already placed are put
 * back as they were (removed when new, rewritten when replaced), the directories this call created
 * are removed, and the error is rethrown. Callers put `bg.json` last, so a failure anywhere leaves
 * it unchanged too. It survives an error, not a kill: that needs a journal, which is not here.
 */
export async function writeAllOrNothing(files: readonly StagedFile[]): Promise<void> {
  const undo: Undo[] = [];
  try {
    for (const [index, file] of files.entries()) {
      await place(file, index, undo);
    }
  } catch (error) {
    const leftovers: string[] = [];
    for (const step of undo.reverse()) {
      try {
        await step();
      } catch (rollbackError) {
        leftovers.push(
          rollbackError instanceof Error ? rollbackError.message : String(rollbackError),
        );
      }
    }
    if (leftovers.length > 0) {
      const reason = error instanceof Error ? error.message : String(error);
      throw new Error(`${reason}; rollback incomplete: ${leftovers.join("; ")}`);
    }
    throw error;
  }
}
