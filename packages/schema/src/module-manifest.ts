import { isRepoRelative } from "./repo-path";

/**
 * `module.json` — the native module format of spec 035.
 *
 * Validation only. Selecting a variant and installing a module belong to `packages/registry`;
 * what lives here is what spec 070 requires of the contract suite: "fails if any `module.json`
 * has an unknown category or an ambiguous `match` set".
 */

/** Spec 035's category table, in its normative topological order. `provider` is first. */
export const MODULE_CATEGORIES = [
  "provider",
  "tooling",
  "config",
  "api",
  "db",
  "orm",
  "auth",
  "ui",
  "email",
  "queue",
  "storage",
  "payments",
  "web",
  "testing",
  "deploy",
  "dev",
] as const;

export type ModuleCategory = (typeof MODULE_CATEGORIES)[number];

/** Categories that admit at most one installed module; the rest are `many`. */
const SINGLE_CATEGORIES = new Set<ModuleCategory>([
  "provider",
  "tooling",
  "config",
  "api",
  "db",
  "orm",
  "auth",
  "ui",
  "email",
  "queue",
  "storage",
  "payments",
]);

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class ModuleManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ModuleManifestError";
  }
}

/** A consumer-facing toggle (spec 035 `options`): `default` is what `--yes` selects. */
export type ModuleOptionValue = string | number | boolean;

export type ModuleOption = {
  description?: string;
  default: ModuleOptionValue;
  values?: ModuleOptionValue[];
};

/** A tier-2 patch (spec 060), as declared. The catalog of types is the patch engine's, not the parser's. */
export type ModulePatch = { type: string } & Record<string, unknown>;

export type ModuleVariant = {
  key: string;
  match: Partial<Record<ModuleCategory, string>>;
  /** The workspace package the variant's `dependencies` are written into. `name` may hold `{{SCOPE}}`. */
  workspace?: { name: string; path: string };
  copy?: string[];
  patch?: ModulePatch[];
  intent?: string[];
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  env?: { name: string; required?: boolean; example?: string }[];
};

export type ModuleManifest = {
  $schema?: string;
  id: string;
  category: ModuleCategory;
  version?: string;
  title: string;
  description: string;
  peers: Partial<Record<ModuleCategory, string[]>>;
  options?: Record<string, ModuleOption>;
  checks?: string[];
  variants: ModuleVariant[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isModuleCategory(value: unknown): value is ModuleCategory {
  return typeof value === "string" && (MODULE_CATEGORIES as readonly string[]).includes(value);
}

export function categoryCardinality(category: ModuleCategory): "one" | "many" {
  return SINGLE_CATEGORIES.has(category) ? "one" : "many";
}

function parseStringArray(value: unknown, where: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string")) {
    throw new ModuleManifestError(`${where} must be an array of strings`);
  }
  return value as string[];
}

function parseVersionMap(value: unknown, where: string): Record<string, string> {
  if (!isRecord(value)) {
    throw new ModuleManifestError(`${where} must be an object`);
  }
  for (const [name, range] of Object.entries(value)) {
    if (typeof range !== "string" || range.length === 0) {
      throw new ModuleManifestError(`${where}.${name} must be a non-empty version string`);
    }
  }
  return value as Record<string, string>;
}

function parseMatch(value: unknown, where: string): Partial<Record<ModuleCategory, string>> {
  if (!isRecord(value)) {
    throw new ModuleManifestError(`${where} must be an object`);
  }
  const match: Partial<Record<ModuleCategory, string>> = {};
  for (const [category, moduleId] of Object.entries(value)) {
    if (!isModuleCategory(category)) {
      throw new ModuleManifestError(`${where} has an unknown category: ${category}`);
    }
    if (typeof moduleId !== "string" || !ID_RE.test(moduleId)) {
      throw new ModuleManifestError(`${where}.${category} must be a kebab-case module id`);
    }
    match[category] = moduleId;
  }
  return match;
}

/** Order-independent signature of a `match` set, so two spellings of one set collide. */
function matchSignature(match: Partial<Record<ModuleCategory, string>>): string {
  return Object.entries(match)
    .map(([category, id]) => `${category}=${id}`)
    .sort()
    .join(",");
}

function parseOptionValue(value: unknown, where: string): ModuleOptionValue {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    throw new ModuleManifestError(`${where} must be a string, number or boolean`);
  }
  return value;
}

function parseOptions(value: unknown): Record<string, ModuleOption> {
  if (!isRecord(value)) {
    throw new ModuleManifestError("options must be an object");
  }
  const options: Record<string, ModuleOption> = {};
  for (const [name, raw] of Object.entries(value)) {
    const where = `options.${name}`;
    if (!isRecord(raw)) {
      throw new ModuleManifestError(`${where} must be an object`);
    }
    if (raw.default === undefined) {
      throw new ModuleManifestError(`${where}.default is required`);
    }
    const option: ModuleOption = { default: parseOptionValue(raw.default, `${where}.default`) };
    if (raw.description !== undefined) {
      if (typeof raw.description !== "string") {
        throw new ModuleManifestError(`${where}.description must be a string`);
      }
      option.description = raw.description;
    }
    if (raw.values !== undefined) {
      if (!Array.isArray(raw.values) || raw.values.length === 0) {
        throw new ModuleManifestError(`${where}.values must be a non-empty array`);
      }
      option.values = raw.values.map((entry: unknown, index) =>
        parseOptionValue(entry, `${where}.values[${index}]`),
      );
      if (!option.values.includes(option.default)) {
        throw new ModuleManifestError(`${where}.default must be one of its values`);
      }
    }
    options[name] = option;
  }
  return options;
}

function parseWorkspace(value: unknown, where: string): { name: string; path: string } {
  if (!isRecord(value)) {
    throw new ModuleManifestError(`${where} must be an object`);
  }
  if (typeof value.name !== "string" || value.name.length === 0) {
    throw new ModuleManifestError(`${where}.name is required`);
  }
  if (typeof value.path !== "string" || !isRepoRelative(value.path)) {
    throw new ModuleManifestError(`${where}.path must be a repo-relative path without '..'`);
  }
  return { name: value.name, path: value.path };
}

function parsePatches(value: unknown, where: string): ModulePatch[] {
  if (!Array.isArray(value)) {
    throw new ModuleManifestError(`${where} must be an array`);
  }
  return value.map((entry: unknown, index) => {
    if (!isRecord(entry) || typeof entry.type !== "string" || entry.type.length === 0) {
      throw new ModuleManifestError(`${where}[${index}].type is required`);
    }
    return { ...entry, type: entry.type };
  });
}

function parseVariant(value: unknown, where: string): ModuleVariant {
  if (!isRecord(value)) {
    throw new ModuleManifestError(`${where} must be an object`);
  }
  if (typeof value.key !== "string" || !ID_RE.test(value.key)) {
    throw new ModuleManifestError(`${where}.key must be a kebab-case identifier`);
  }
  const variant: ModuleVariant = {
    key: value.key,
    match: parseMatch(value.match ?? {}, `${where}.match`),
  };
  if (value.workspace !== undefined) {
    variant.workspace = parseWorkspace(value.workspace, `${where}.workspace`);
  }
  if (value.copy !== undefined) {
    variant.copy = parseStringArray(value.copy, `${where}.copy`);
    variant.copy.forEach((glob, index) => {
      if (!isRepoRelative(glob)) {
        throw new ModuleManifestError(
          `${where}.copy[${index}] must be a path relative to template/ without '..': ${glob}`,
        );
      }
    });
  }
  if (value.patch !== undefined) {
    variant.patch = parsePatches(value.patch, `${where}.patch`);
  }
  if (value.intent !== undefined) {
    variant.intent = parseStringArray(value.intent, `${where}.intent`);
  }
  if (value.dependencies !== undefined) {
    variant.dependencies = parseVersionMap(value.dependencies, `${where}.dependencies`);
  }
  if (value.devDependencies !== undefined) {
    variant.devDependencies = parseVersionMap(value.devDependencies, `${where}.devDependencies`);
  }
  if (value.env !== undefined) {
    if (!Array.isArray(value.env)) {
      throw new ModuleManifestError(`${where}.env must be an array`);
    }
    variant.env = value.env.map((entry, index) => {
      if (!isRecord(entry) || typeof entry.name !== "string" || entry.name.length === 0) {
        throw new ModuleManifestError(`${where}.env[${index}].name is required`);
      }
      const parsed: { name: string; required?: boolean; example?: string } = { name: entry.name };
      if (entry.required !== undefined) {
        if (typeof entry.required !== "boolean") {
          throw new ModuleManifestError(`${where}.env[${index}].required must be a boolean`);
        }
        parsed.required = entry.required;
      }
      if (entry.example !== undefined) {
        if (typeof entry.example !== "string") {
          throw new ModuleManifestError(`${where}.env[${index}].example must be a string`);
        }
        parsed.example = entry.example;
      }
      return parsed;
    });
  }
  return variant;
}

export function parseModuleManifest(input: unknown): ModuleManifest {
  if (!isRecord(input)) {
    throw new ModuleManifestError("module.json must be an object");
  }
  if (typeof input.id !== "string" || !ID_RE.test(input.id)) {
    throw new ModuleManifestError("id must be a kebab-case identifier");
  }
  if (!isModuleCategory(input.category)) {
    throw new ModuleManifestError(
      `category must be one of ${MODULE_CATEGORIES.join(", ")}, got: ${String(input.category)}`,
    );
  }
  for (const field of ["title", "description"] as const) {
    if (typeof input[field] !== "string" || (input[field] as string).length === 0) {
      throw new ModuleManifestError(`${field} is required`);
    }
  }
  if (input.version !== undefined && typeof input.version !== "string") {
    throw new ModuleManifestError("version must be a string when present");
  }

  const peers: Partial<Record<ModuleCategory, string[]>> = {};
  if (input.peers !== undefined) {
    if (!isRecord(input.peers)) {
      throw new ModuleManifestError("peers must be an object");
    }
    for (const [category, allowed] of Object.entries(input.peers)) {
      if (!isModuleCategory(category)) {
        throw new ModuleManifestError(`peers has an unknown category: ${category}`);
      }
      const ids = parseStringArray(allowed, `peers.${category}`);
      for (const id of ids) {
        if (!ID_RE.test(id)) {
          throw new ModuleManifestError(`peers.${category} has a non-kebab-case id: ${id}`);
        }
      }
      peers[category] = ids;
    }
  }

  if (!Array.isArray(input.variants) || input.variants.length === 0) {
    throw new ModuleManifestError("variants must be a non-empty array");
  }
  const variants = input.variants.map((variant, index) =>
    parseVariant(variant, `variants[${index}]`),
  );

  const seenKeys = new Set<string>();
  const seenMatches = new Map<string, string>();
  for (const variant of variants) {
    if (seenKeys.has(variant.key)) {
      throw new ModuleManifestError(`variants have a duplicate key: ${variant.key}`);
    }
    seenKeys.add(variant.key);

    // Spec 035: "Ties are a registry authoring error and MUST fail the contract test, not be
    // resolved at runtime." Two variants with the same match set are that tie, statically.
    const signature = matchSignature(variant.match);
    const previous = seenMatches.get(signature);
    if (previous !== undefined) {
      throw new ModuleManifestError(
        `variants ${previous} and ${variant.key} have an ambiguous match set: ` +
          `{${signature || "default"}}`,
      );
    }
    seenMatches.set(signature, variant.key);
  }

  const manifest: ModuleManifest = {
    id: input.id,
    category: input.category,
    title: input.title as string,
    description: input.description as string,
    peers,
    variants,
  };
  if (input.options !== undefined) {
    manifest.options = parseOptions(input.options);
  }
  if (input.checks !== undefined) {
    manifest.checks = parseStringArray(input.checks, "checks");
  }
  if (typeof input.$schema === "string") {
    manifest.$schema = input.$schema;
  }
  if (typeof input.version === "string") {
    manifest.version = input.version;
  }
  return manifest;
}
