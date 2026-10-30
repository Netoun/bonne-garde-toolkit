import { join } from "node:path";
import type { PatchStatus, ProjectManifest } from "@bonne-garde/schema";
import { readDisk } from "./disk";
import type { ModulePlan } from "./module-plan";
import { inspectPatch, patchRegions, writePatch } from "./patch-ops";
import type { PlannedPatch } from "./patch-plan";
import { pendingIntention, type PendingIntention } from "./pending-intentions";

/** What one region of a patch did. `replaced` is the text `--force` overwrote (`null`: it was not a string). */
export type RegionReport = {
  region: string;
  status: "applied" | "skipped";
  replaced?: string | null;
};

/**
 * What one tier-2 patch did (spec 060), in the detail `bg add` prints. `bg.json` keeps the first
 * four fields of it under the module's `patches`; the regions are in `bg.json` under `regions`.
 */
export type PatchReport = {
  module: string;
  type: PlannedPatch["type"];
  file: string;
  status: PatchStatus;
  /** Why a `failed` patch did not apply. */
  reason?: string;
  /** The id of the pending intention a `failed` patch became (spec 060 "Degradation"). */
  intention?: string;
  regions: RegionReport[];
};

export type PatchStaging = {
  reports: PatchReport[];
  /** The regions to merge into `bg.json`: file to region to owner. */
  regions: Record<string, Record<string, string>>;
  /** The patched files that no module writes in this call, with what they will hold. */
  patched: Map<string, string>;
  /** The pending intentions the failed patches became, one per id. */
  pending: PendingIntention[];
  /** Conflicts `--force` does not bypass. */
  refused: string[];
  /** Conflicts `--force` overwrites. */
  collisions: string[];
};

type Text = { ok: true; text: string } | { ok: false; reason: string };

/**
 * A tier-1 file as its owner wrote it: `template` with the owner's own patches on that file and no
 * other module's, each region it names written when absent. This is what `bg.json` records the
 * sha256 of, so that the record is the same whether another module's patches land in the same call or
 * in a later one, and a file nobody else touched still counts as untouched.
 */
export function ownVersion(plan: ModulePlan, target: string, template: string): string {
  return plan.patches
    .filter(({ file }) => file === target)
    .reduce((text, patch) => {
      const inspected = inspectPatch(text, patch);
      if (!inspected.ok) {
        return text;
      }
      const absent = new Set(
        patchRegions(patch)
          .map(({ region }) => region)
          .filter(
            (region) => (inspected.states.get(region) ?? { kind: "absent" }).kind === "absent",
          ),
      );
      return absent.size > 0 ? writePatch(text, patch, absent) : text;
    }, template);
}

/**
 * Spec 060 tier 2, in the virtual tree. `tierOne` holds what each module file of this call will
 * contain; a patch reads and rewrites that, or the file on disk, and a later patch on the same file
 * sees the earlier one. Nothing is written here. A patch that cannot apply is a `failed` report and
 * does not stop the rest; a conflict is not a failure of the patch but a refusal of the call, so it
 * is collected for the caller to throw once every conflict is known.
 *
 * Per script, 060's conflict table: a region owned by another module is refused always; present and
 * equal is skipped (and claimed, as an identical file is); present and differing, or written by the
 * project with no region recorded, is a collision that `force` overwrites; absent is written.
 */
export async function stagePatches(options: {
  projectRoot: string;
  manifest: ProjectManifest;
  plans: ModulePlan[];
  /** Target to content for the module files of this call. Rewritten in place when a patch edits one. */
  tierOne: Map<string, string>;
  /** Target to owner for everything this call writes whole, items included. */
  claimed: Map<string, string>;
  force: boolean;
}): Promise<PatchStaging> {
  const { projectRoot, manifest, plans, tierOne, claimed, force } = options;
  const staging: PatchStaging = {
    reports: [],
    regions: {},
    patched: new Map(),
    pending: [],
    refused: [],
    collisions: [],
  };
  const texts = new Map(tierOne);
  const touched = new Set<string>();
  const regionClaims = new Map<string, string>();

  const currentText = async (file: string): Promise<Text> => {
    const staged = texts.get(file);
    if (staged !== undefined) {
      return { ok: true, text: staged };
    }
    const rival = claimed.get(file);
    if (rival !== undefined) {
      return {
        ok: false,
        reason: `${file} is also written by ${rival} in this call, and a patch cannot compose with an item's file`,
      };
    }
    const disk = await readDisk(join(projectRoot, file));
    if (disk.kind === "absent") {
      return { ok: false, reason: `${file} does not exist` };
    }
    return disk.kind === "file"
      ? { ok: true, text: disk.content }
      : { ok: false, reason: `${file} is not a regular file` };
  };

  for (const plan of plans) {
    for (const patch of plan.patches) {
      const { file } = patch;
      const report: PatchReport = {
        module: plan.key,
        type: patch.type,
        file,
        status: "skipped",
        regions: [],
      };
      staging.reports.push(report);
      const fail = (reason: string) => {
        const intention = pendingIntention(plan.key, plan.checks, patch, reason);
        report.status = "failed";
        report.reason = reason;
        report.intention = intention.id;
        if (!staging.pending.some(({ id }) => id === intention.id)) {
          staging.pending.push(intention);
        }
      };

      const current = await currentText(file);
      if (!current.ok) {
        fail(current.reason);
        continue;
      }
      const inspected = inspectPatch(current.text, patch);
      if (!inspected.ok) {
        fail(`${file}: ${inspected.reason}`);
        continue;
      }

      const write = new Set<string>();
      let conflicted = false;
      for (const { region, declared } of patchRegions(patch)) {
        const claim = `${file}\0${region}`;
        const earlier = regionClaims.get(claim);
        const recorded = manifest.regions[file]?.[region];
        if (earlier !== undefined && earlier !== plan.key) {
          staging.refused.push(
            `${region} of ${file} is named by both ${earlier} and ${plan.key} in this call`,
          );
          conflicted = true;
          continue;
        }
        if (recorded !== undefined && recorded !== plan.key) {
          staging.refused.push(
            `${region} of ${file} is owned by ${recorded}, and ${plan.key} would write it`,
          );
          conflicted = true;
          continue;
        }
        regionClaims.set(claim, plan.key);

        const state = inspected.states.get(region) ?? { kind: "absent" };
        if (state.kind === "absent") {
          write.add(region);
          report.regions.push({ region, status: "applied" });
        } else if (state.kind === "equal") {
          report.regions.push({ region, status: "skipped" });
        } else if (force) {
          write.add(region);
          report.regions.push({ region, status: "applied", replaced: state.current });
        } else {
          staging.collisions.push(
            `${region} of ${file} is ${state.shown}, which differs from what ${plan.key} declares (${declared})`,
          );
          conflicted = true;
          continue;
        }
        staging.regions[file] = { ...staging.regions[file], [region]: plan.key };
      }

      if (conflicted) {
        // The call is refused; what the patch would have written is not worth composing.
        continue;
      }
      if (write.size > 0) {
        report.status = "applied";
        texts.set(file, writePatch(current.text, patch, write));
        touched.add(file);
      }
    }
  }

  // A module file that a patch edited holds the patched text from here on; any other is `patched`.
  for (const file of touched) {
    const text = texts.get(file) ?? "";
    if (tierOne.has(file)) {
      tierOne.set(file, text);
    } else {
      staging.patched.set(file, text);
    }
  }
  return staging;
}
