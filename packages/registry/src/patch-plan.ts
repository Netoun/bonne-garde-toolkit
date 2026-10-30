import { isRepoRelative, type ModulePatch, type ModuleVariant } from "@bonne-garde/schema";
import { DEPENDENCY_MAPS, type DependencyMap } from "./package-dependencies";
import { PlanError } from "./resolve-plan";

/**
 * Tier-2 patches as a variant declares them (spec 060), checked. Each type is applied by this CLI
 * or refused at planning time, never skipped: the catalog is closed, and a variant is never
 * installed with a patch it could not apply. Every type also takes an optional `intent`: the
 * sentence a failed patch carries into the pending intention it becomes.
 */
export type ScriptsMergePatch = {
  type: "scripts.merge";
  file: string;
  intent?: string;
  scripts: Record<string, string>;
};

export type JsoncMergePatch = {
  type: "jsonc.merge";
  file: string;
  intent?: string;
  /** The leaves to merge: an object is walked, anything else (an array too) is a leaf written whole. */
  value: Record<string, unknown>;
};

export type PackageDependenciesPatch = {
  type: "package.dependencies";
  file: string;
  intent?: string;
  /**
   * The entries to add, name to version, either map possibly empty and not both. A name has `{{SCOPE}}`
   * rendered, and is the key of the region `bg.json` records (`dependencies.<name>`); a version is as written.
   */
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

export type AddImportPatch = {
  type: "ts.addImport";
  file: string;
  intent?: string;
  /** With `{{SCOPE}}` rendered: it is the key of the region `bg.json` records. */
  moduleSpecifier: string;
  namedImports: string[];
};

export type AddNamedExportPatch = {
  type: "ts.addNamedExport";
  file: string;
  intent?: string;
  /** With `{{SCOPE}}` rendered, as for `ts.addImport`. */
  moduleSpecifier: string;
  exports: string[];
};

export type ElysiaUsePatch = {
  type: "ts.elysiaUse";
  file: string;
  intent?: string;
  /** The exported `const` whose chain gains the `.use`. */
  targetName: string;
  /** The identifier passed to `.use(...)`; importing it is a `ts.addImport` of its own. */
  argument: string;
};

/** Every patch the engine applies. The union grows with each patch type; the refusal below names what is missing. */
export type PlannedPatch =
  | ScriptsMergePatch
  | JsoncMergePatch
  | PackageDependenciesPatch
  | AddImportPatch
  | AddNamedExportPatch
  | ElysiaUsePatch;

const APPLIED = [
  "scripts.merge",
  "jsonc.merge",
  "package.dependencies",
  "ts.addImport",
  "ts.addNamedExport",
  "ts.elysiaUse",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const SCOPE_REFUSAL =
  "only tier-1 files are rendered with the scope, a patch writes into a file the project owns";

type Refuse = (why: string) => never;

/** The arguments of a patch are its own: one this type does not know is an authoring error, not ignored. */
function checkArguments(refuse: Refuse, patch: ModulePatch, known: readonly string[]): void {
  const unknown = Object.keys(patch).filter(
    (name) => name !== "type" && name !== "intent" && !known.includes(name),
  );
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

/** The entries of one dependency map, names rendered with the scope: each a non-empty version, each name once. */
function parseDependencyMap(
  refuse: Refuse,
  patch: ModulePatch,
  map: DependencyMap,
  scope: string,
): Record<string, string> {
  const declared = patch[map];
  if (declared === undefined) {
    return {};
  }
  if (!isRecord(declared)) {
    return refuse(`${map} must be an object of package names to versions`);
  }
  const written: Record<string, string> = {};
  for (const [declaredName, version] of Object.entries(declared)) {
    const name = declaredName.replaceAll("{{SCOPE}}", scope);
    if (name.length === 0) {
      return refuse(`${map} has an empty package name`);
    }
    if (typeof version !== "string" || version.length === 0) {
      return refuse(`${map}.${declaredName} must be a non-empty version string`);
    }
    if (version.includes("{{SCOPE}}")) {
      return refuse(
        `${map}.${declaredName} holds {{SCOPE}} in its version: only a package name is rendered with the scope`,
      );
    }
    if (Object.hasOwn(written, name)) {
      return refuse(`${map} names ${name} twice`);
    }
    written[name] = version;
  }
  return written;
}

function parsePackageDependencies(
  refuse: Refuse,
  patch: ModulePatch,
  scope: string,
): PackageDependenciesPatch {
  checkArguments(refuse, patch, ["file", ...DEPENDENCY_MAPS]);
  const file = checkFile(refuse, patch);
  if (file.split("/").at(-1) !== "package.json") {
    return refuse(`file must be a package.json, got: ${file}`);
  }
  const dependencies = parseDependencyMap(refuse, patch, "dependencies", scope);
  const devDependencies = parseDependencyMap(refuse, patch, "devDependencies", scope);
  if (Object.keys(dependencies).length + Object.keys(devDependencies).length === 0) {
    return refuse(
      "it declares no dependency: dependencies and devDependencies are missing or empty",
    );
  }
  const both = Object.keys(dependencies).find((name) => Object.hasOwn(devDependencies, name));
  if (both !== undefined) {
    return refuse(`${both} is in dependencies and in devDependencies`);
  }
  return { type: "package.dependencies", file, dependencies, devDependencies };
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

function checkIdentifier(refuse: Refuse, patch: ModulePatch, argument: string): string {
  const value = patch[argument];
  if (typeof value !== "string" || !IDENTIFIER.test(value)) {
    return refuse(`${argument} must be an identifier, got: ${JSON.stringify(value)}`);
  }
  return value;
}

function parseElysiaUse(refuse: Refuse, patch: ModulePatch): ElysiaUsePatch {
  checkArguments(refuse, patch, ["file", "targetName", "argument"]);
  return {
    type: "ts.elysiaUse",
    file: checkTsFile(refuse, patch),
    targetName: checkIdentifier(refuse, patch, "targetName"),
    argument: checkIdentifier(refuse, patch, "argument"),
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
    const { intent } = patch;
    const withIntent = <P extends PlannedPatch>(planned: P): P =>
      intent === undefined ? planned : { ...planned, intent };
    switch (patch.type) {
      case "scripts.merge":
        return withIntent(parseScriptsMerge(refuse, patch));
      case "jsonc.merge":
        return withIntent(parseJsoncMerge(refuse, patch));
      case "package.dependencies":
        return withIntent(parsePackageDependencies(refuse, patch, scope));
      case "ts.addImport":
        return withIntent(parseAddImport(refuse, patch, scope));
      case "ts.addNamedExport":
        return withIntent(parseAddNamedExport(refuse, patch, scope));
      case "ts.elysiaUse":
        return withIntent(parseElysiaUse(refuse, patch));
      default: {
        const file = typeof patch.file === "string" ? ` on ${patch.file}` : "";
        throw new PlanError(
          `${key} declares patch ${patch.type}${file}: this CLI does not apply it yet (${APPLIED.join(", ")} are applied), and a variant is never installed with another patch skipped`,
        );
      }
    }
  });
}
