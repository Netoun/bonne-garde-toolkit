import { recordIntention, type IntentionOutcome } from "@bonne-garde/schema";
import { readStagedIntentions } from "./intentions/staged";
import { loadManifest, writeManifest } from "./manifest-file";

export type RecordResult = {
  /** `"platform"`, or `<category>/<module-id>`. */
  recordedIn: string;
  /** The version `bg.json` was written as when it had to be migrated to v2, else `null`. */
  migratedFrom: 1 | null;
  /** Whether `.bg/` still held this intention. It is disposable, so `false` is not an error. */
  staged: boolean;
};

/**
 * Spec 065 step 5: record one intention's outcome in `bg.json`. The CLI cannot run the intention's
 * Validation, so recording is the caller's statement that it passed; what the CLI does check is
 * that the id is canonical and, for an install id, that its module is installed.
 */
export async function recordIntentionOutcome(
  projectRoot: string,
  id: string,
  outcome: IntentionOutcome,
): Promise<RecordResult> {
  const { manifest, migratedFrom } = await loadManifest(projectRoot);
  const recorded = recordIntention(manifest, id, outcome);
  const { staged } = await readStagedIntentions(projectRoot);
  await writeManifest(projectRoot, recorded.manifest);
  return {
    recordedIn: recorded.recordedIn,
    migratedFrom,
    staged: staged.some((intention) => intention.id === id),
  };
}
