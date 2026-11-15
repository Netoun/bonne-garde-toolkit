import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  adaptedPaths,
  isModuleCategory,
  recordIntention,
  type IntentionOutcome,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { readStagedIntentions } from "./intentions/staged";
import { loadManifest, writeManifest } from "./manifest-file";

export type RecordResult = {
  /** `"platform"`, or `<category>/<module-id>`. */
  recordedIn: string;
  /** The version `bg.json` was written as when it had to be migrated to v2, else `null`. */
  migratedFrom: 1 | null;
  /** Whether `.bg/` still held this intention. It is disposable, so `false` is not an error. */
  staged: boolean;
  /** The project files that took an `intent[<id>]` region: what an applied install intention edited (060). */
  marked: string[];
  /** The files it declares `adapt` that are not a file of the project, so took none. */
  notFiles: string[];
};

async function isFile(projectRoot: string, path: string): Promise<boolean> {
  try {
    return (await stat(join(projectRoot, path))).isFile();
  } catch {
    return false;
  }
}

/**
 * The files an install intention edits, from what outlives `.bg/` first: a failed patch is an
 * intention whose one `adapt` path is the file it failed on, and `bg.json` records both. Any other
 * intention is its document, which `add` staged. `null` when neither is there to be read.
 */
async function declaredAdapt(
  projectRoot: string,
  manifest: ProjectManifest,
  id: string,
  stagedFile: string | undefined,
): Promise<string[] | null> {
  const [category, moduleId] = id.split("/");
  const record = isModuleCategory(category)
    ? manifest.modules[category]?.find((entry) => entry.id === moduleId)
    : undefined;
  const patch = record?.patches.find((entry) => entry.intention === id);
  if (patch !== undefined) {
    return [patch.file];
  }
  if (stagedFile === undefined) {
    return null;
  }
  try {
    return adaptedPaths(await readFile(join(projectRoot, stagedFile), "utf8"));
  } catch {
    return null;
  }
}

/**
 * Spec 065 step 5: record one intention's outcome in `bg.json`. The CLI cannot run the intention's
 * Validation, so recording is the caller's statement that it passed; what the CLI does check is
 * that the id is canonical and, for an install id, that its module is installed.
 *
 * An applied install intention also marks each file it declares `adapt` with an `intent[<id>]` region
 * of its module (060), so that file is checked by region and not read as another module's file the
 * project modified. A path that is not a file of the project takes none: a region in a file that is
 * not there would be a `doctor` error.
 *
 * An applied install intention whose `adapt` paths cannot be read, because no failed patch of its module
 * names it and `.bg/` no longer holds its document, is refused and nothing is written: recording it would
 * leave its files unmarked, and `doctor --strict` calling them user-modified for good. It is still pending,
 * so `bg add <module>` stages it again. `--skip` edited nothing and needs no paths.
 */
export async function recordIntentionOutcome(
  projectRoot: string,
  id: string,
  outcome: IntentionOutcome,
): Promise<RecordResult> {
  const { manifest, migratedFrom } = await loadManifest(projectRoot);
  const { staged } = await readStagedIntentions(projectRoot);
  const stagedFile = staged.find((intention) => intention.id === id)?.file;

  const declared =
    outcome.status === "applied"
      ? await declaredAdapt(projectRoot, manifest, id, stagedFile)
      : null;
  const adapted: string[] = [];
  const notFiles: string[] = [];
  for (const path of declared ?? []) {
    ((await isFile(projectRoot, path)) ? adapted : notFiles).push(path);
  }

  // After `recordIntention`, which refuses a bad id or a module that is not installed first.
  const recorded = recordIntention(
    manifest,
    id,
    outcome.status === "applied" ? { status: "applied", adapted } : outcome,
  );
  const install = recorded.recordedIn !== "platform";
  if (install && outcome.status === "applied" && declared === null) {
    throw new Error(
      `cannot record ${id} as applied: no failed patch of ${recorded.recordedIn} names it and .bg/ no longer holds its document, ` +
        "so the files it edited cannot be found to mark. Nothing was recorded. " +
        `Run \`bg add ${recorded.recordedIn}\` to stage it again (every add stages an intention that is not recorded yet), resolve it, then record it.`,
    );
  }
  await writeManifest(projectRoot, recorded.manifest);

  return {
    recordedIn: recorded.recordedIn,
    migratedFrom,
    staged: stagedFile !== undefined,
    marked: install ? adapted : [],
    notFiles: install ? notFiles : [],
  };
}
