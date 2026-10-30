import { inspectJsonc, jsonRegion, jsoncLeaves, setJsoncLeaves } from "./jsonc-merge";
import type { PlannedPatch } from "./patch-plan";
import type { RegionState } from "./region-state";
import { inspectScripts, scriptRegion, setScripts } from "./scripts-merge";
import {
  addImport,
  addNamedExport,
  exportRegion,
  importRegion,
  inspectImport,
  inspectNamedExport,
} from "./ts-patches";

/**
 * What the engine asks of every tier-2 patch type (spec 060), so that the conflict table lives in
 * one place (`stagePatches`) and `doctor` reads every kind of region the same way. A patch names
 * regions; against a file's text each one is absent, equal to what the patch declares, or something
 * else; and a chosen subset of them can be written. The closed catalog is a `switch` per function, with no
 * default, so a type added to `PlannedPatch` fails to compile until each one handles it.
 */

export type { RegionState };

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
    case "jsonc.merge":
      return jsoncLeaves(patch.value).map(({ path, value }) => ({
        region: jsonRegion(path),
        declared: JSON.stringify(value),
      }));
    case "ts.addImport":
      return [
        {
          region: importRegion(patch.moduleSpecifier),
          declared: `{ ${patch.namedImports.join(", ")} }`,
        },
      ];
    case "ts.addNamedExport":
      return [
        {
          region: exportRegion(patch.moduleSpecifier),
          declared: `{ ${patch.exports.join(", ")} }`,
        },
      ];
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
    case "jsonc.merge":
      return inspectJsonc(text, jsoncLeaves(patch.value));
    case "ts.addImport":
    case "ts.addNamedExport": {
      const inspected =
        patch.type === "ts.addImport"
          ? inspectImport(patch.file, text, patch.moduleSpecifier, patch.namedImports)
          : inspectNamedExport(patch.file, text, patch.moduleSpecifier, patch.exports);
      return inspected.ok
        ? {
            ok: true,
            states: new Map([
              [
                patch.type === "ts.addImport"
                  ? importRegion(patch.moduleSpecifier)
                  : exportRegion(patch.moduleSpecifier),
                inspected.state,
              ],
            ]),
          }
        : inspected;
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
    case "jsonc.merge":
      return setJsoncLeaves(
        text,
        jsoncLeaves(patch.value).filter(({ path }) => regions.has(jsonRegion(path))),
      );
    case "ts.addImport":
      return regions.has(importRegion(patch.moduleSpecifier))
        ? addImport(patch.file, text, patch.moduleSpecifier, patch.namedImports)
        : text;
    case "ts.addNamedExport":
      return regions.has(exportRegion(patch.moduleSpecifier))
        ? addNamedExport(patch.file, text, patch.moduleSpecifier, patch.exports)
        : text;
  }
}
