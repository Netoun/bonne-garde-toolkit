export type InstallRecord = {
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

export type ProjectManifest = {
  $schema?: string;
  version: 1;
  scope: string;
  platform: PlatformState;
  registries: Record<string, string>;
  installed: Record<string, InstallRecord>;
  capabilities?: string[];
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
/** Canonical intention ids: `vX.Y.Z/slug`. */
const INTENTION_ID_RE = /^v\d+\.\d+\.\d+\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseInstallRecord(name: string, value: unknown): InstallRecord {
  if (!isRecord(value)) {
    throw new ProjectManifestError(`installed.${name} must be an object`);
  }
  const { source, version, installedAt } = value;
  if (typeof source !== "string" || source.length === 0) {
    throw new ProjectManifestError(`installed.${name}.source is required`);
  }
  if (typeof version !== "string" || version.length === 0) {
    throw new ProjectManifestError(`installed.${name}.version is required`);
  }
  if (typeof installedAt !== "string" || installedAt.length === 0) {
    throw new ProjectManifestError(`installed.${name}.installedAt is required`);
  }
  return { source, version, installedAt };
}

function assertIntentionId(id: string, where: string): void {
  if (!INTENTION_ID_RE.test(id)) {
    throw new ProjectManifestError(
      `${where} must be a canonical intention id (vX.Y.Z/slug), got: ${id}`,
    );
  }
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
  if (typeof value.remote !== "string" || value.remote.length === 0) {
    throw new ProjectManifestError("platform.remote is required");
  }
  if (!isRecord(value.intentions)) {
    throw new ProjectManifestError("platform.intentions must be an object");
  }
  const appliedRaw = value.intentions.applied;
  if (!Array.isArray(appliedRaw) || appliedRaw.some((id) => typeof id !== "string")) {
    throw new ProjectManifestError("platform.intentions.applied must be an array of strings");
  }
  const applied = appliedRaw as string[];
  for (const id of applied) {
    assertIntentionId(id, "platform.intentions.applied[]");
  }

  if (!isRecord(value.intentions.skipped)) {
    throw new ProjectManifestError("platform.intentions.skipped must be an object");
  }
  const skipped: Record<string, string> = {};
  for (const [id, reason] of Object.entries(value.intentions.skipped)) {
    assertIntentionId(id, "platform.intentions.skipped key");
    if (typeof reason !== "string" || reason.length === 0) {
      throw new ProjectManifestError(
        `platform.intentions.skipped.${id} must be a non-empty reason string`,
      );
    }
    skipped[id] = reason;
  }

  return {
    version: value.version,
    remote: value.remote,
    intentions: { applied, skipped },
  };
}

export function parseProjectManifest(input: unknown): ProjectManifest {
  if (!isRecord(input)) {
    throw new ProjectManifestError("bg.json must be an object");
  }
  if (input.version !== 1) {
    throw new ProjectManifestError(`unsupported bg.json version: ${String(input.version)}`);
  }
  if (typeof input.scope !== "string" || !SCOPE_RE.test(input.scope)) {
    throw new ProjectManifestError("scope must match ^@[a-z0-9-]+$");
  }
  if (input.platform === undefined) {
    throw new ProjectManifestError("platform is required");
  }
  const platform = parsePlatform(input.platform);

  if (!isRecord(input.registries)) {
    throw new ProjectManifestError("registries must be an object");
  }
  const registries: Record<string, string> = {};
  for (const [key, value] of Object.entries(input.registries)) {
    if (typeof value !== "string" || value.length === 0) {
      throw new ProjectManifestError(`registries.${key} must be a non-empty string`);
    }
    registries[key] = value;
  }
  if (!isRecord(input.installed)) {
    throw new ProjectManifestError("installed must be an object");
  }
  const installed: Record<string, InstallRecord> = {};
  for (const [name, value] of Object.entries(input.installed)) {
    installed[name] = parseInstallRecord(name, value);
  }

  let capabilities: string[] | undefined;
  if (input.capabilities !== undefined) {
    if (
      !Array.isArray(input.capabilities) ||
      input.capabilities.some((c) => typeof c !== "string")
    ) {
      throw new ProjectManifestError("capabilities must be an array of strings");
    }
    capabilities = input.capabilities as string[];
  }

  const manifest: ProjectManifest = {
    version: 1,
    scope: input.scope,
    platform,
    registries,
    installed,
  };
  if (typeof input.$schema === "string") {
    manifest.$schema = input.$schema;
  }
  if (capabilities) {
    manifest.capabilities = capabilities;
  }
  return manifest;
}

export function createEmptyProjectManifest(options: {
  scope: string;
  registries: Record<string, string>;
  platformVersion?: string;
  platformRemote?: string;
}): ProjectManifest {
  return parseProjectManifest({
    version: 1,
    scope: options.scope,
    platform: {
      version: options.platformVersion ?? "0.0.0",
      remote: options.platformRemote ?? "github:Netoun/bonne-garde-boilerplate",
      intentions: { applied: [], skipped: {} },
    },
    registries: options.registries,
    installed: {},
    capabilities: [],
  });
}
