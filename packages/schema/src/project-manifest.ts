import { categoryCardinality, isModuleCategory, type ModuleCategory } from "./module-manifest";
import { isRepoRelative } from "./repo-path";

/** This repo's slug — written to a new project's `platform.remote`, and the registry source once published. */
export const DEFAULT_PLATFORM_REMOTE = "github:Netoun/bonne-garde-toolkit";

/** An item from a shadcn-style registry (spec 030), recorded under `items`. */
export type ItemRecord = {
  source: string;
  version: string;
  installedAt: string;
};

export type PlatformIntentions = {
  applied: string[];
  skipped: Record<string, string>;
};

export type PlatformState = {
  version: string;
  remote: string;
  intentions: PlatformIntentions;
};

export type AppRecord = {
  id: string;
  /** Repo-relative, traversal-safe. */
  dir: string;
  kind: string;
};

export type PatchStatus = "applied" | "skipped" | "failed";

/** Outcome of one tier-2 patch (spec 060). `reason` is required when `status` is `failed`. */
export type PatchOutcome = {
  type: string;
  file: string;
  status: PatchStatus;
  reason?: string;
};

/** Same shape as `PlatformIntentions`, with module-scoped ids (`<category>/<module-id>/<slug>`). */
export type ModuleIntentions = {
  applied: string[];
  skipped: Record<string, string>;
};

/** An installed native module (spec 035), recorded under `modules[<category>]`. */
export type ModuleRecord = {
  id: string;
  variant: string;
  version: string;
  installedAt: string;
  options: Record<string, unknown>;
  patches: PatchOutcome[];
  intentions: ModuleIntentions;
};

/** A tier-1 file the platform wrote: who owns it and the SHA-256 of what was written. */
export type FileRecord = {
  owner: string;
  sha256: string;
};

export type ProjectManifest = {
  $schema?: string;
  version: 2;
  scope: string;
  platform: PlatformState;
  registries: Record<string, string>;
  apps: AppRecord[];
  modules: Partial<Record<ModuleCategory, ModuleRecord[]>>;
  items: Record<string, ItemRecord>;
  files: Record<string, FileRecord>;
  /** file → region key → owner. */
  regions: Record<string, Record<string, string>>;
};

export type ProjectManifestRead = {
  manifest: ProjectManifest;
  /** The version the file was written as when it had to be migrated to v2, else `null`. */
  migratedFrom: 1 | null;
};

export class ProjectManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectManifestError";
  }
}

const SCOPE_RE = /^@[a-z0-9-]+$/;
/** Lockstep semver without leading `v`. */
const PLATFORM_VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;
/** Canonical platform intention ids: `vX.Y.Z/slug`. */
const PLATFORM_INTENTION_ID_RE = /^v\d+\.\d+\.\d+\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** Canonical module intention ids: `<category>/<module-id>/<slug>` (spec 065). */
const MODULE_INTENTION_ID_RE =
  /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SHA256_RE = /^[0-9a-f]{64}$/;
const PATCH_STATUSES: readonly PatchStatus[] = ["applied", "skipped", "failed"];

function isPatchStatus(value: unknown): value is PatchStatus {
  return PATCH_STATUSES.some((status) => status === value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function parseItemRecord(where: string, value: unknown): ItemRecord {
  if (!isRecord(value)) {
    throw new ProjectManifestError(`${where} must be an object`);
  }
  const { source, version, installedAt } = value;
  if (!isNonEmptyString(source)) {
    throw new ProjectManifestError(`${where}.source is required`);
  }
  if (!isNonEmptyString(version)) {
    throw new ProjectManifestError(`${where}.version is required`);
  }
  if (!isNonEmptyString(installedAt)) {
    throw new ProjectManifestError(`${where}.installedAt is required`);
  }
  return { source, version, installedAt };
}

function parseItems(value: unknown, where: string): Record<string, ItemRecord> {
  if (!isRecord(value)) {
    throw new ProjectManifestError(`${where} must be an object`);
  }
  const items: Record<string, ItemRecord> = {};
  for (const [name, record] of Object.entries(value)) {
    items[name] = parseItemRecord(`${where}.${name}`, record);
  }
  return items;
}

/** `applied` list + `skipped` map, shared by the platform block and module records. */
function parseIntentions(
  value: unknown,
  where: string,
  idPattern: RegExp,
  idShape: string,
): PlatformIntentions {
  if (!isRecord(value)) {
    throw new ProjectManifestError(`${where} must be an object`);
  }
  const assertId = (id: string, at: string) => {
    if (!idPattern.test(id)) {
      throw new ProjectManifestError(
        `${at} must be a canonical intention id (${idShape}), got: ${id}`,
      );
    }
  };

  const appliedRaw = value.applied;
  if (!Array.isArray(appliedRaw) || appliedRaw.some((id) => typeof id !== "string")) {
    throw new ProjectManifestError(`${where}.applied must be an array of strings`);
  }
  const applied = appliedRaw as string[];
  for (const id of applied) {
    assertId(id, `${where}.applied[]`);
  }

  if (!isRecord(value.skipped)) {
    throw new ProjectManifestError(`${where}.skipped must be an object`);
  }
  const skipped: Record<string, string> = {};
  for (const [id, reason] of Object.entries(value.skipped)) {
    assertId(id, `${where}.skipped key`);
    if (!isNonEmptyString(reason)) {
      throw new ProjectManifestError(`${where}.skipped.${id} must be a non-empty reason string`);
    }
    skipped[id] = reason;
  }
  return { applied, skipped };
}

function parsePlatform(value: unknown): PlatformState {
  if (!isRecord(value)) {
    throw new ProjectManifestError("platform must be an object");
  }
  if (typeof value.version !== "string" || !PLATFORM_VERSION_RE.test(value.version)) {
    throw new ProjectManifestError(
      "platform.version must be semver without a leading v (e.g. 0.1.0)",
    );
  }
  if (!isNonEmptyString(value.remote)) {
    throw new ProjectManifestError("platform.remote is required");
  }
  return {
    version: value.version,
    remote: value.remote,
    intentions: parseIntentions(
      value.intentions,
      "platform.intentions",
      PLATFORM_INTENTION_ID_RE,
      "vX.Y.Z/slug",
    ),
  };
}

function parseRegistries(value: unknown): Record<string, string> {
  if (!isRecord(value)) {
    throw new ProjectManifestError("registries must be an object");
  }
  const registries: Record<string, string> = {};
  for (const [key, source] of Object.entries(value)) {
    if (!isNonEmptyString(source)) {
      throw new ProjectManifestError(`registries.${key} must be a non-empty string`);
    }
    registries[key] = source;
  }
  return registries;
}

function parseApps(value: unknown): AppRecord[] {
  if (!Array.isArray(value)) {
    throw new ProjectManifestError("apps must be an array");
  }
  return value.map((entry: unknown, index) => {
    const where = `apps[${index}]`;
    if (!isRecord(entry)) {
      throw new ProjectManifestError(`${where} must be an object`);
    }
    const { id, dir, kind } = entry;
    if (!isNonEmptyString(id)) {
      throw new ProjectManifestError(`${where}.id is required`);
    }
    if (!isNonEmptyString(dir) || !isRepoRelative(dir)) {
      throw new ProjectManifestError(`${where}.dir must be a repo-relative path without '..'`);
    }
    if (!isNonEmptyString(kind)) {
      throw new ProjectManifestError(`${where}.kind is required`);
    }
    return { id, dir, kind };
  });
}

function parsePatch(value: unknown, where: string): PatchOutcome {
  if (!isRecord(value)) {
    throw new ProjectManifestError(`${where} must be an object`);
  }
  const { type, file, status, reason } = value;
  if (!isNonEmptyString(type)) {
    throw new ProjectManifestError(`${where}.type is required`);
  }
  if (!isNonEmptyString(file) || !isRepoRelative(file)) {
    throw new ProjectManifestError(`${where}.file must be a repo-relative path without '..'`);
  }
  if (!isPatchStatus(status)) {
    throw new ProjectManifestError(`${where}.status must be one of ${PATCH_STATUSES.join(", ")}`);
  }
  const patch: PatchOutcome = { type, file, status };
  if (reason !== undefined) {
    if (!isNonEmptyString(reason)) {
      throw new ProjectManifestError(`${where}.reason must be a non-empty string`);
    }
    patch.reason = reason;
  } else if (status === "failed") {
    throw new ProjectManifestError(`${where}.reason is required when status is failed`);
  }
  return patch;
}

function parseModuleRecord(value: unknown, where: string): ModuleRecord {
  if (!isRecord(value)) {
    throw new ProjectManifestError(`${where} must be an object`);
  }
  const { id, variant, version, installedAt, options, patches, intentions } = value;
  if (!isNonEmptyString(id)) {
    throw new ProjectManifestError(`${where}.id is required`);
  }
  if (!isNonEmptyString(variant)) {
    throw new ProjectManifestError(`${where}.variant is required`);
  }
  if (!isNonEmptyString(version)) {
    throw new ProjectManifestError(`${where}.version is required`);
  }
  if (!isNonEmptyString(installedAt)) {
    throw new ProjectManifestError(`${where}.installedAt is required`);
  }
  if (!isRecord(options)) {
    throw new ProjectManifestError(`${where}.options must be an object`);
  }
  if (!Array.isArray(patches)) {
    throw new ProjectManifestError(`${where}.patches must be an array`);
  }
  return {
    id,
    variant,
    version,
    installedAt,
    options,
    patches: patches.map((patch: unknown, index) =>
      parsePatch(patch, `${where}.patches[${index}]`),
    ),
    intentions: parseIntentions(
      intentions,
      `${where}.intentions`,
      MODULE_INTENTION_ID_RE,
      "<category>/<module-id>/<slug>",
    ),
  };
}

function parseModules(value: unknown): ProjectManifest["modules"] {
  if (!isRecord(value)) {
    throw new ProjectManifestError("modules must be an object");
  }
  const modules: ProjectManifest["modules"] = {};
  for (const [category, records] of Object.entries(value)) {
    if (!isModuleCategory(category)) {
      throw new ProjectManifestError(`modules has an unknown category: ${category}`);
    }
    if (!Array.isArray(records)) {
      throw new ProjectManifestError(`modules.${category} must be an array`);
    }
    if (categoryCardinality(category) === "one" && records.length > 1) {
      throw new ProjectManifestError(
        `modules.${category} holds ${records.length} records but ${category} admits at most one (corrupt state)`,
      );
    }
    modules[category] = records.map((record: unknown, index) =>
      parseModuleRecord(record, `modules.${category}[${index}]`),
    );
  }
  return modules;
}

function parseFiles(value: unknown): Record<string, FileRecord> {
  if (!isRecord(value)) {
    throw new ProjectManifestError("files must be an object");
  }
  const files: Record<string, FileRecord> = {};
  for (const [path, record] of Object.entries(value)) {
    if (!isRepoRelative(path)) {
      throw new ProjectManifestError(
        `files key must be a repo-relative path without '..': ${path}`,
      );
    }
    if (!isRecord(record)) {
      throw new ProjectManifestError(`files.${path} must be an object`);
    }
    if (!isNonEmptyString(record.owner)) {
      throw new ProjectManifestError(`files.${path}.owner is required`);
    }
    if (typeof record.sha256 !== "string" || !SHA256_RE.test(record.sha256)) {
      throw new ProjectManifestError(`files.${path}.sha256 must be 64 lowercase hex characters`);
    }
    files[path] = { owner: record.owner, sha256: record.sha256 };
  }
  return files;
}

function parseRegions(value: unknown): Record<string, Record<string, string>> {
  if (!isRecord(value)) {
    throw new ProjectManifestError("regions must be an object");
  }
  const regions: Record<string, Record<string, string>> = {};
  for (const [file, owned] of Object.entries(value)) {
    if (!isRepoRelative(file)) {
      throw new ProjectManifestError(
        `regions key must be a repo-relative path without '..': ${file}`,
      );
    }
    if (!isRecord(owned)) {
      throw new ProjectManifestError(`regions.${file} must be an object`);
    }
    const byRegion: Record<string, string> = {};
    for (const [region, owner] of Object.entries(owned)) {
      if (!isNonEmptyString(owner)) {
        throw new ProjectManifestError(`regions.${file}.${region} must be a non-empty owner id`);
      }
      byRegion[region] = owner;
    }
    regions[file] = byRegion;
  }
  return regions;
}

/** The fields both manifest versions carry unchanged. */
function parseCommon(input: Record<string, unknown>): {
  $schema?: string;
  scope: string;
  platform: PlatformState;
  registries: Record<string, string>;
} {
  if (typeof input.scope !== "string" || !SCOPE_RE.test(input.scope)) {
    throw new ProjectManifestError("scope must match ^@[a-z0-9-]+$");
  }
  if (input.platform === undefined) {
    throw new ProjectManifestError("platform is required");
  }
  return {
    ...(typeof input.$schema === "string" ? { $schema: input.$schema } : {}),
    scope: input.scope,
    platform: parsePlatform(input.platform),
    registries: parseRegistries(input.registries),
  };
}

function assertManifestObject(input: unknown): asserts input is Record<string, unknown> {
  if (!isRecord(input)) {
    throw new ProjectManifestError("bg.json must be an object");
  }
}

/**
 * Strict v2 parser: the shape `add` / `create` write and re-validate. A v1 file is refused here
 * so a caller cannot migrate by accident — `readProjectManifest` is the entry that reads a file.
 */
export function parseProjectManifest(input: unknown): ProjectManifest {
  assertManifestObject(input);
  if (input.version === 1) {
    throw new ProjectManifestError(
      "bg.json is version 1; read it with readProjectManifest to migrate it to version 2",
    );
  }
  if (input.version !== 2) {
    throw new ProjectManifestError(`unsupported bg.json version: ${String(input.version)}`);
  }
  const common = parseCommon(input);
  return {
    ...(common.$schema !== undefined ? { $schema: common.$schema } : {}),
    version: 2,
    scope: common.scope,
    platform: common.platform,
    registries: common.registries,
    apps: parseApps(input.apps),
    modules: parseModules(input.modules),
    items: parseItems(input.items, "items"),
    files: parseFiles(input.files),
    regions: parseRegions(input.regions),
  };
}

/**
 * Spec 020 "Migration from v1": `installed` becomes `items`, `capabilities` is dropped, and `files`
 * / `regions` start empty — pre-v2 files are user-owned until re-added. Every v1 `installed` entry
 * was written by the item engine, so none of them is a module record.
 */
function migrateV1(input: Record<string, unknown>): ProjectManifest {
  const common = parseCommon(input);
  const items = parseItems(input.installed, "installed");
  if (
    input.capabilities !== undefined &&
    (!Array.isArray(input.capabilities) || input.capabilities.some((c) => typeof c !== "string"))
  ) {
    throw new ProjectManifestError("capabilities must be an array of strings");
  }
  return {
    ...(common.$schema !== undefined ? { $schema: common.$schema } : {}),
    version: 2,
    scope: common.scope,
    platform: common.platform,
    registries: common.registries,
    apps: [],
    modules: {},
    items,
    files: {},
    regions: {},
  };
}

/**
 * Reads a `bg.json` of any supported version as a v2 manifest. `migratedFrom` tells the caller the
 * file was v1, so the CLI can state the rewrite instead of doing it silently (spec 020). Unknown
 * versions fail closed.
 */
export function readProjectManifest(input: unknown): ProjectManifestRead {
  assertManifestObject(input);
  if (input.version === 1) {
    return { manifest: migrateV1(input), migratedFrom: 1 };
  }
  return { manifest: parseProjectManifest(input), migratedFrom: null };
}

export type IntentionOutcome = { status: "applied" } | { status: "skipped"; reason: string };

export type RecordedIntention = {
  manifest: ProjectManifest;
  /** `"platform"`, or `<category>/<module-id>` for an install intention. */
  recordedIn: string;
};

/** An id sits in exactly one of `applied` / `skipped`; recording it again moves it, never repeats it. */
function withOutcome(
  intentions: PlatformIntentions,
  id: string,
  outcome: IntentionOutcome,
): PlatformIntentions {
  const skipped = Object.fromEntries(
    Object.entries(intentions.skipped).filter(([skippedId]) => skippedId !== id),
  );
  if (outcome.status === "applied") {
    return {
      applied: intentions.applied.includes(id) ? intentions.applied : [...intentions.applied, id],
      skipped,
    };
  }
  return {
    applied: intentions.applied.filter((appliedId) => appliedId !== id),
    skipped: { ...skipped, [id]: outcome.reason },
  };
}

/**
 * Spec 065 "Recording": the outcome of one intention lands where its id says it belongs. A release
 * id (`vX.Y.Z/slug`) goes to `platform.intentions`; an install id (`<category>/<module-id>/<slug>`)
 * goes to that module's record, which must exist. Returns a new manifest; nothing is written here,
 * and whether the intention's Validation passed is the caller's to have established.
 */
export function recordIntention(
  manifest: ProjectManifest,
  id: string,
  outcome: IntentionOutcome,
): RecordedIntention {
  if (outcome.status === "skipped" && outcome.reason.trim().length === 0) {
    throw new ProjectManifestError(`skipping ${id} needs a reason`);
  }

  if (PLATFORM_INTENTION_ID_RE.test(id)) {
    return {
      manifest: parseProjectManifest({
        ...manifest,
        platform: {
          ...manifest.platform,
          intentions: withOutcome(manifest.platform.intentions, id, outcome),
        },
      }),
      recordedIn: "platform",
    };
  }

  if (!MODULE_INTENTION_ID_RE.test(id)) {
    throw new ProjectManifestError(
      `not a canonical intention id: ${id} (expected vX.Y.Z/slug or <category>/<module-id>/<slug>)`,
    );
  }
  const [category, moduleId] = id.split("/");
  if (!isModuleCategory(category)) {
    throw new ProjectManifestError(`${id}: unknown category: ${String(category)}`);
  }
  const records = manifest.modules[category] ?? [];
  const target = records.find((record) => record.id === moduleId);
  if (!target) {
    throw new ProjectManifestError(
      `${category}/${String(moduleId)} is not installed, so ${id} has no module record to land in`,
    );
  }
  return {
    manifest: parseProjectManifest({
      ...manifest,
      modules: {
        ...manifest.modules,
        [category]: records.map((record) =>
          record === target
            ? { ...record, intentions: withOutcome(record.intentions, id, outcome) }
            : record,
        ),
      },
    }),
    recordedIn: `${category}/${target.id}`,
  };
}

export function createEmptyProjectManifest(options: {
  scope: string;
  registries: Record<string, string>;
  platformVersion?: string;
  platformRemote?: string;
}): ProjectManifest {
  return parseProjectManifest({
    version: 2,
    scope: options.scope,
    platform: {
      version: options.platformVersion ?? "0.0.0",
      remote: options.platformRemote ?? DEFAULT_PLATFORM_REMOTE,
      intentions: { applied: [], skipped: {} },
    },
    registries: options.registries,
    apps: [],
    modules: {},
    items: {},
    files: {},
    regions: {},
  });
}
