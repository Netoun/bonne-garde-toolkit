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

export type AddImportPatch = {
  type: "ts.addImport";
  file: string;
  /** With `{{SCOPE}}` rendered: it is the key of the region `bg.json` records. */
  moduleSpecifier: string;
  namedImports: string[];
};

export type AddNamedExportPatch = {
  type: "ts.addNamedExport";
  file: string;
  /** With `{{SCOPE}}` rendered, as for `ts.addImport`. */
  moduleSpecifier: string;
  exports: string[];
};

/** Every patch the engine applies. The union grows with each patch type; the refusal below names what is missing. */
export type PlannedPatch =
  | ScriptsMergePatch
  | JsoncMergePatch
  | AddImportPatch
  | AddNamedExportPatch;

const APPLIED = ["scripts.merge", "jsonc.merge", "ts.addImport", "ts.addNamedExport"] as const;

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

const TS_FILE = /\.(?:[cm]?ts|tsx)$/;
const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]*$/;

function checkTsFile(refuse: Refuse, patch: ModulePatch): string {
  const file = checkFile(refuse, patch);
  if (!TS_FILE.test(file)) {
    return refuse(`file must be a .ts or .tsx file, got: ${file}`);
  }
  return file;
}

/** The module a TS patch names, with the scope rendered: a specifier is a declared value, not text of the project's file. */
function checkSpecifier(refuse: Refuse, patch: ModulePatch, scope: string): string {
  const { moduleSpecifier } = patch;
  if (typeof moduleSpecifier !== "string" || moduleSpecifier.length === 0) {
    return refuse("moduleSpecifier must be a non-empty string");
  }
  if (/[\r\n]/.test(moduleSpecifier)) {
    return refuse("moduleSpecifier must be on one line");
  }
  return moduleSpecifier.replaceAll("{{SCOPE}}", scope);
}

/** The names a TS patch brings: identifiers, each once, in the order they are written. */
function checkNames(refuse: Refuse, patch: ModulePatch, argument: string): string[] {
  const names = patch[argument];
  if (!Array.isArray(names) || names.length === 0) {
    return refuse(`${argument} must be a non-empty array of names`);
  }
  const written: string[] = [];
  for (const name of names) {
    if (typeof name !== "string" || !IDENTIFIER.test(name)) {
      return refuse(`${argument} must hold identifiers, got: ${JSON.stringify(name)}`);
    }
    if (written.includes(name)) {
      return refuse(`${argument} names ${name} twice`);
    }
    written.push(name);
  }
  return written;
}

function parseAddImport(refuse: Refuse, patch: ModulePatch, scope: string): AddImportPatch {
  checkArguments(refuse, patch, ["file", "moduleSpecifier", "namedImports"]);
  const file = checkTsFile(refuse, patch);
  return {
    type: "ts.addImport",
    file,
    moduleSpecifier: checkSpecifier(refuse, patch, scope),
    namedImports: checkNames(refuse, patch, "namedImports"),
  };
}

function parseAddNamedExport(
  refuse: Refuse,
  patch: ModulePatch,
  scope: string,
): AddNamedExportPatch {
  checkArguments(refuse, patch, ["file", "moduleSpecifier", "exports"]);
  const file = checkTsFile(refuse, patch);
  return {
    type: "ts.addNamedExport",
    file,
    moduleSpecifier: checkSpecifier(refuse, patch, scope),
    exports: checkNames(refuse, patch, "exports"),
  };
}

/**
 * The patches of the selected variant, checked. A type this CLI does not apply fails the install
 * before anything is written, and so does a malformed argument: both are registry authoring errors.
 */
export function plannedPatches(key: string, variant: ModuleVariant, scope: string): PlannedPatch[] {
  return (variant.patch ?? []).map((patch) => {
    const refuse: Refuse = (why) => {
      throw new PlanError(`${key} declares patch ${patch.type}: ${why}`);
    };
    switch (patch.type) {
      case "scripts.merge":
        return parseScriptsMerge(refuse, patch);
      case "jsonc.merge":
        return parseJsoncMerge(refuse, patch);
      case "ts.addImport":
        return parseAddImport(refuse, patch, scope);
      case "ts.addNamedExport":
        return parseAddNamedExport(refuse, patch, scope);
      default: {
        const file = typeof patch.file === "string" ? ` on ${patch.file}` : "";
        throw new PlanError(
          `${key} declares patch ${patch.type}${file}: this CLI does not apply it yet (${APPLIED.join(", ")} are applied), and a variant is never installed with another patch skipped`,
        );
      }
    }
  });
}
