import type { PlannedPatch } from "./patch-plan";
import { inspectScripts, scriptRegion, setScripts } from "./scripts-merge";

/**
 * What the engine asks of every tier-2 patch type (spec 060), so that the conflict table lives in
 * one place (`stagePatches`) and `doctor` reads every kind of region the same way. A patch names
 * regions; against a file's text each one is absent, equal to what the patch declares, or something
 * else; and a chosen subset of them can be written. The closed catalog is a `switch` per function, with no
 * default, so a type added to `PlannedPatch` fails to compile until each one handles it.
 */

/** What the file holds at one region, against what the patch declares for it. */
export type RegionState =
  | { kind: "absent" }
  | { kind: "equal" }
  /** `current` is what `--force` replaces (`null`: it has no text); `shown` is how a message quotes it. */
  | { kind: "differs"; current: string | null; shown: string };

/** One region a patch writes, with the value it declares for it as a message quotes it. */
export type RegionDeclaration = { region: string; declared: string };

export type PatchInspection =
  | { ok: true; states: Map<string, RegionState> }
  | { ok: false; reason: string };

/** The regions a patch writes, in the order it declares them. */
export function patchRegions(patch: PlannedPatch): RegionDeclaration[] {
  switch (patch.type) {
    case "scripts.merge":
      return Object.entries(patch.scripts).map(([name, command]) => ({
        region: scriptRegion(name),
        declared: JSON.stringify(command),
      }));
  }
}

/** The state of each region the patch names in `text`, or why the file cannot hold the patch. */
export function inspectPatch(text: string, patch: PlannedPatch): PatchInspection {
  switch (patch.type) {
    case "scripts.merge": {
      const inspected = inspectScripts(text, patch.scripts);
      if (!inspected.ok) {
        return inspected;
      }
      const states = new Map<string, RegionState>();
      for (const [name, state] of Object.entries(inspected.states)) {
        states.set(
          scriptRegion(name),
          state.kind === "differs"
            ? {
                kind: "differs",
                current: state.current,
                shown: state.current === null ? "not a string" : JSON.stringify(state.current),
              }
            : state,
        );
      }
      return { ok: true, states };
    }
  }
}

/**
 * `text` with the named regions written and every other byte as it was. The caller has decided
 * which regions to write (absent ones, and differing ones under `--force`) after `inspectPatch`
 * said the file can hold the patch.
 */
export function writePatch(
  text: string,
  patch: PlannedPatch,
  regions: ReadonlySet<string>,
): string {
  switch (patch.type) {
    case "scripts.merge":
      return setScripts(
        text,
        Object.fromEntries(
          Object.entries(patch.scripts).filter(([name]) => regions.has(scriptRegion(name))),
        ),
      );
  }
}
