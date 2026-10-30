import { isRepoRelative, type ModulePatch, type ModuleVariant } from "@bonne-garde/schema";
import { PlanError } from "./resolve-plan";

/**
 * Tier-2 patches as a variant declares them (spec 060), checked. Each type is applied by this CLI
 * or refused at planning time, never skipped: the catalog is closed, and a variant is never
 * installed with a patch it could not apply.
 */
export type ScriptsMergePatch = {
  type: "scripts.merge";
  file: string;
  scripts: Record<string, string>;
};

export type JsoncMergePatch = {
  type: "jsonc.merge";
  file: string;
  /** The leaves to merge: an object is walked, anything else (an array too) is a leaf written whole. */
  value: Record<string, unknown>;
};

/** Every patch the engine applies. The union grows with each patch type; the refusal below names what is missing. */
export type PlannedPatch = ScriptsMergePatch | JsoncMergePatch;

const APPLIED = ["scripts.merge", "jsonc.merge"] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCOPE_REFUSAL =
  "only tier-1 files are rendered with the scope, a patch writes into a file the project owns";

type Refuse = (why: string) => never;

/** The arguments of a patch are its own: one this type does not know is an authoring error, not ignored. */
function checkArguments(refuse: Refuse, patch: ModulePatch, known: readonly string[]): void {
  const unknown = Object.keys(patch).filter((name) => name !== "type" && !known.includes(name));
  if (unknown.length > 0) {
    refuse(`it has an argument it does not know: ${unknown.join(", ")}`);
  }
}

function checkFile(refuse: Refuse, patch: ModulePatch): string {
  const { file } = patch;
  if (typeof file !== "string" || !isRepoRelative(file)) {
    return refuse("file must be a repo-relative path without '..'");
  }
  return file;
}

function parseScriptsMerge(refuse: Refuse, patch: ModulePatch): ScriptsMergePatch {
  checkArguments(refuse, patch, ["file", "scripts"]);
  const file = checkFile(refuse, patch);
  if (file.split("/").at(-1) !== "package.json") {
    return refuse(`file must be a package.json, got: ${file}`);
  }
  const { scripts } = patch;
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
      return refuse(`scripts.${name} holds {{SCOPE}}: ${SCOPE_REFUSAL}`);
    }
    written[name] = command;
  }
  return { type: "scripts.merge", file, scripts: written };
}

/** Walks a `jsonc.merge` value: no placeholder anywhere, and no object that would name no leaf. */
function checkJsoncValue(refuse: Refuse, value: unknown, path: string): void {
  if (typeof value === "string" && value.includes("{{SCOPE}}")) {
    refuse(`value holds {{SCOPE}} at ${path}: ${SCOPE_REFUSAL}`);
  }
  if (Array.isArray(value)) {
    value.forEach((item) => checkJsoncValue(refuse, item, path));
  } else if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0 && path !== "value") {
      refuse(`${path} is an empty object, which names no leaf`);
    }
    for (const [key, child] of entries) {
      if (key.includes("{{SCOPE}}")) {
        refuse(`value holds {{SCOPE}} in the key ${JSON.stringify(key)}: ${SCOPE_REFUSAL}`);
      }
      checkJsoncValue(refuse, child, `${path}.${key}`);
    }
  }
}

function parseJsoncMerge(refuse: Refuse, patch: ModulePatch): JsoncMergePatch {
  checkArguments(refuse, patch, ["file", "value"]);
  const file = checkFile(refuse, patch);
  if (!file.endsWith(".json") && !file.endsWith(".jsonc")) {
    return refuse(`file must be a .json or .jsonc file, got: ${file}`);
  }
  const { value } = patch;
  if (!isRecord(value)) {
    return refuse("value must be an object of the leaves to merge");
  }
  if (Object.keys(value).length === 0) {
    return refuse("value is empty");
  }
  checkJsoncValue(refuse, value, "value");
  return { type: "jsonc.merge", file, value };
}

/**
 * The patches of the selected variant, checked. A type this CLI does not apply fails the install
 * before anything is written, and so does a malformed argument: both are registry authoring errors.
 */
export function plannedPatches(key: string, variant: ModuleVariant): PlannedPatch[] {
  return (variant.patch ?? []).map((patch) => {
    const refuse: Refuse = (why) => {
      throw new PlanError(`${key} declares patch ${patch.type}: ${why}`);
    };
    switch (patch.type) {
      case "scripts.merge":
        return parseScriptsMerge(refuse, patch);
      case "jsonc.merge":
        return parseJsoncMerge(refuse, patch);
      default: {
        const file = typeof patch.file === "string" ? ` on ${patch.file}` : "";
        throw new PlanError(
          `${key} declares patch ${patch.type}${file}: this CLI does not apply it yet (${APPLIED.join(", ")} are applied), and a variant is never installed with another patch skipped`,
        );
      }
    }
  });
}
