import { patchRegions } from "./patch-ops";
import type { PlannedPatch } from "./patch-plan";

/**
 * Spec 060 "Degradation": a patch that cannot apply is converted into a pending tier-3 intention
 * (065), carrying the patch's intent, its target file and why it failed. This is the data; writing
 * it under `.bg/` is the CLI's, and recording it in `bg.json` is `bg record`'s.
 */

export type PendingIntention = {
  /** `<category>/<module-id>/<slug>` (065): `bg record` lands it in that module's record. */
  id: string;
  /** `<category>/<module-id>` of the module whose patch failed. */
  module: string;
  type: PlannedPatch["type"];
  file: string;
  /** What the patch was to do: the module's own sentence, else one made from the patch. */
  intent: string;
  /** Why it failed. */
  reason: string;
  /** Observable done-when, one line per region the patch writes. */
  gaps: string[];
  /** The module's `checks`: the Validation of the intention, which `add` withholds until it is resolved. */
  checks: string[];
};

const kebab = (text: string): string =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

/**
 * The id of the intention a failed patch becomes: `<category>/<module-id>/patch-<type>-<file>-<region>`,
 * in kebab case. The module part is the module whose patch failed, so `bg record` finds its record;
 * the slug names the patch by what it is (its type, its file, its first region) and not by its place
 * in the list, so it is the same on every `add` and when a module reorders its patches, which keeps
 * staging idempotent and a recorded outcome valid. The `patch-` prefix keeps it clear of the slugs
 * of the intentions a module authors under `intent/`.
 */
export function patchIntentId(moduleKey: string, patch: PlannedPatch): string {
  const [first] = patchRegions(patch);
  return `${moduleKey}/${["patch", kebab(patch.type), kebab(patch.file), kebab(first?.region ?? "")]
    .filter((part) => part !== "")
    .join("-")}`;
}

/** The module's `intent` for the patch, else a sentence that says what the patch writes and where. */
export function patchIntentText(moduleKey: string, patch: PlannedPatch): string {
  if (patch.intent !== undefined) {
    return patch.intent;
  }
  const held = patchRegions(patch)
    .map(({ region, declared }) => `${region} = ${declared}`)
    .join("; ");
  return `The ${patch.type} patch of ${moduleKey} makes ${patch.file} hold: ${held}.`;
}

export function pendingIntention(
  moduleKey: string,
  checks: string[],
  patch: PlannedPatch,
  reason: string,
): PendingIntention {
  return {
    id: patchIntentId(moduleKey, patch),
    module: moduleKey,
    type: patch.type,
    file: patch.file,
    intent: patchIntentText(moduleKey, patch),
    reason,
    gaps: patchRegions(patch).map(
      ({ region, declared }) => `${region} of ${patch.file} is ${declared}`,
    ),
    checks,
  };
}
