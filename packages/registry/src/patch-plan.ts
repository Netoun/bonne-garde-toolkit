import { isRepoRelative, type ModulePatch, type ModuleVariant } from "@bonne-garde/schema";
import { PlanError } from "./resolve-plan";

/**
 * `scripts.merge` as a variant declares it (spec 060). It is the one tier-2 patch this CLI applies;
 * the rest of the catalog is refused at planning time, never skipped.
 */
export type ScriptsMergePatch = {
  type: "scripts.merge";
  file: string;
  scripts: Record<string, string>;
};

/** Every patch the engine applies. The union grows with each patch type; the refusal below names what is missing. */
export type PlannedPatch = ScriptsMergePatch;

const SCRIPTS_MERGE_ARGUMENTS = new Set(["type", "file", "scripts"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseScriptsMerge(key: string, patch: ModulePatch): ScriptsMergePatch {
  const refuse = (why: string): never => {
    throw new PlanError(`${key} declares patch scripts.merge: ${why}`);
  };

  const unknown = Object.keys(patch).filter((name) => !SCRIPTS_MERGE_ARGUMENTS.has(name));
  if (unknown.length > 0) {
    refuse(`it has an argument it does not know: ${unknown.join(", ")}`);
  }
  const { file, scripts } = patch;
  if (typeof file !== "string" || !isRepoRelative(file)) {
    return refuse("file must be a repo-relative path without '..'");
  }
  if (file.split("/").at(-1) !== "package.json") {
    return refuse(`file must be a package.json, got: ${file}`);
  }
  if (!isRecord(scripts)) {
    return refuse("scripts must be an object of script names to commands");
  }
  const entries = Object.entries(scripts);
  if (entries.length === 0) {
    return refuse("scripts is empty");
  }
  const written: Record<string, string> = {};
  for (const [name, command] of entries) {
    if (typeof command !== "string" || command.length === 0) {
      return refuse(`scripts.${name} must be a non-empty string`);
    }
    if (command.includes("{{SCOPE}}")) {
      return refuse(
        `scripts.${name} holds {{SCOPE}}: only tier-1 files are rendered with the scope, a patch writes into a file the project owns`,
      );
    }
    written[name] = command;
  }
  return { type: "scripts.merge", file, scripts: written };
}

/**
 * The patches of the selected variant, checked. A type this CLI does not apply fails the install
 * before anything is written, and so does a malformed argument: both are registry authoring errors.
 */
export function plannedPatches(key: string, variant: ModuleVariant): PlannedPatch[] {
  return (variant.patch ?? []).map((patch) => {
    if (patch.type === "scripts.merge") {
      return parseScriptsMerge(key, patch);
    }
    const file = typeof patch.file === "string" ? ` on ${patch.file}` : "";
    throw new PlanError(
      `${key} declares patch ${patch.type}${file}: only scripts.merge is applied yet, and a variant is never installed with another patch skipped`,
    );
  });
}
