import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import {
  inspectPatch,
  patchRegions,
  plannedPatches,
  isReadableRegion,
  readInstalledModuleManifest,
  regionPresence,
  sha256Hex,
  type ModuleManifestLookup,
  type PatchInspection,
  type PlannedPatch,
} from "@bonne-garde/registry";
import {
  MODULE_CATEGORIES,
  readProjectManifest,
  type ModuleCategory,
  type ModuleRecord,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { readStagedIntentions, type StagedIntention } from "./intentions/staged";
import { defaultSource } from "./manifest-file";

/**
 * `bg doctor` (spec 050): what `bg.json` says against what is on disk, with no network.
 *
 * Severity, one rule: an **error** is a record that contradicts the tree or itself (a recorded
 * file that is gone, an owner that is not installed, a peer category that is empty), so plain
 * `doctor` exits 1. A **warning** is divergence spec 060 says to keep and report (a file the
 * consumer edited, a patch that failed, an intention still pending), which only `--strict` fails.
 */

export type Severity = "error" | "warning";
export type CheckStatus = "ok" | Severity | "skipped";

export type Finding = {
  severity: Severity;
  code: string;
  message: string;
  /** Project-relative, when the finding is about one file. */
  path?: string;
};

export type CheckReport<Details> = {
  status: CheckStatus;
  summary: string;
  /** `null` when the check was skipped. */
  details: Details | null;
  findings: Finding[];
  /** What the check does not look at, and why. A clean result is only as wide as this says. */
  notes: string[];
};

export type ManifestDetails = {
  /** What the file declares, even when it is not a version this CLI can read. */
  version: number | null;
  platformVersion: string | null;
  modules: number;
  items: number;
  files: number;
};
export type FilesDetails = {
  tracked: number;
  intact: number;
  modified: string[];
  missing: string[];
  unreadable: string[];
  /** Present, and not sha-checked: a patch edits a file with recorded regions, so its regions are read instead. */
  byRegion: string[];
  /** Always empty: unrecorded files are the consumer's own code. See the note on the check. */
  untrackedButExpected: string[];
};
export type RegionsDetails = {
  files: number;
  regions: number;
  /** `<file>#<region>`, for every region read in its file. */
  checked: string[];
  /** Recorded, and gone from the file. */
  missing: string[];
  /** Present, and not what the owning module declares. */
  foreignEdit: string[];
  /** Of a kind doctor cannot resolve yet: nothing was compared. */
  unchecked: string[];
};
export type PatchesDetails = { applied: number; skipped: number; failed: number };
export type IntentionsDetails = {
  applied: string[];
  skipped: Record<string, string>;
  pending: StagedIntention[];
};
export type PeersDetails = { checked: string[]; unchecked: string[] };

export type DoctorReport = {
  status: "ok" | Severity;
  checks: {
    manifest: CheckReport<ManifestDetails>;
    files: CheckReport<FilesDetails>;
    regions: CheckReport<RegionsDetails>;
    patches: CheckReport<PatchesDetails>;
    intentions: CheckReport<IntentionsDetails>;
    peers: CheckReport<PeersDetails>;
  };
};

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function worst(statuses: readonly CheckStatus[]): "ok" | Severity {
  if (statuses.includes("error")) {
    return "error";
  }
  return statuses.includes("warning") ? "warning" : "ok";
}

function report<Details>(
  summary: string,
  details: Details,
  findings: Finding[],
  notes: string[] = [],
): CheckReport<Details> {
  return { status: worst(findings.map((f) => f.severity)), summary, details, findings, notes };
}

function skipped<Details>(why: string): CheckReport<Details> {
  return { status: "skipped", summary: why, details: null, findings: [], notes: [] };
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

type InstalledModule = { key: string; record: ModuleRecord };

/** Installed modules in the category table's topological order, keyed `<category>/<id>`. */
function installedModules(
  manifest: ProjectManifest,
): (InstalledModule & { category: ModuleCategory })[] {
  return MODULE_CATEGORIES.flatMap((category) =>
    (manifest.modules[category] ?? []).map((record) => ({
      category,
      key: `${category}/${record.id}`,
      record,
    })),
  );
}

function isInstalledOwner(manifest: ProjectManifest, owner: string): boolean {
  return (
    Object.hasOwn(manifest.items, owner) ||
    installedModules(manifest).some((installed) => installed.key === owner)
  );
}

async function checkManifest(
  projectRoot: string,
): Promise<{ check: CheckReport<ManifestDetails>; manifest: ProjectManifest | null }> {
  const failure = (code: string, message: string, version: number | null) => ({
    manifest: null,
    check: report<ManifestDetails>(
      "bg.json cannot be used",
      { version, platformVersion: null, modules: 0, items: 0, files: 0 },
      [{ severity: "error", code, message, path: "bg.json" }],
    ),
  });

  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(join(projectRoot, "bg.json"), "utf8")) as unknown;
  } catch (error) {
    if (isMissing(error)) {
      return failure("manifest-missing", `bg.json not found in ${projectRoot}`, null);
    }
    return failure("manifest-invalid", `bg.json cannot be read: ${reasonOf(error)}`, null);
  }

  let read: ReturnType<typeof readProjectManifest>;
  try {
    read = readProjectManifest(raw);
  } catch (error) {
    const declared =
      typeof raw === "object" && raw !== null && "version" in raw && typeof raw.version === "number"
        ? raw.version
        : null;
    return failure("manifest-invalid", reasonOf(error), declared);
  }

  const { manifest, migratedFrom } = read;
  const modules = installedModules(manifest).length;
  const items = Object.keys(manifest.items).length;
  const files = Object.keys(manifest.files).length;
  const findings: Finding[] = [];
  if (migratedFrom !== null) {
    findings.push({
      severity: "warning",
      code: "manifest-v1",
      path: "bg.json",
      message:
        "bg.json is version 1; the next add or record rewrites it as version 2 (installed becomes " +
        "items, capabilities is dropped, files and regions start empty, so every file already in " +
        "the project is user-owned until re-added)",
    });
  }
  return {
    manifest,
    check: report(
      `version ${migratedFrom ?? manifest.version}${migratedFrom === null ? "" : " (read as 2)"}, ` +
        `${plural(modules, "module")}, ${plural(items, "item")}, ${plural(files, "file")}`,
      {
        version: migratedFrom ?? manifest.version,
        platformVersion: manifest.platform.version,
        modules,
        items,
        files,
      },
      findings,
    ),
  };
}

async function checkFiles(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<CheckReport<FilesDetails>> {
  const details: FilesDetails = {
    tracked: 0,
    intact: 0,
    modified: [],
    missing: [],
    unreadable: [],
    byRegion: [],
    untrackedButExpected: [],
  };
  const findings: Finding[] = [];

  for (const [path, record] of Object.entries(manifest.files)) {
    details.tracked += 1;
    let bytes: Uint8Array;
    try {
      bytes = await readFile(join(projectRoot, path));
    } catch (error) {
      if (isMissing(error)) {
        details.missing.push(path);
        findings.push({
          severity: "error",
          code: "file-missing",
          path,
          message: `${path} is missing: recorded for ${record.owner}, absent from the tree`,
        });
      } else {
        details.unreadable.push(path);
        findings.push({
          severity: "error",
          code: "file-unreadable",
          path,
          message: `${path} cannot be read: ${reasonOf(error)}`,
        });
      }
      continue;
    }
    if (Object.keys(manifest.regions[path] ?? {}).length > 0) {
      // A patch rewrote the file `bg.json` recorded the sha256 of, so the sha says nothing about an
      // edit by the user (060 Checksums): the regions check reads what the patches wrote instead.
      details.byRegion.push(path);
    } else if (sha256Hex(bytes) === record.sha256) {
      details.intact += 1;
    } else {
      details.modified.push(path);
      findings.push({
        severity: "warning",
        code: "file-modified",
        path,
        message: `${path} is user-modified: its sha256 differs from the one recorded for ${record.owner}`,
      });
    }
  }

  const problems = [
    details.modified.length > 0 ? `${details.modified.length} user-modified` : null,
    details.missing.length > 0 ? `${details.missing.length} missing` : null,
    details.unreadable.length > 0 ? `${details.unreadable.length} unreadable` : null,
    details.byRegion.length > 0 ? `${details.byRegion.length} checked by region` : null,
  ].filter((part) => part !== null);
  return report(
    `${details.tracked} tracked: ${[`${details.intact} intact`, ...problems].join(", ")}`,
    details,
    findings,
    [
      "untracked-but-expected is not checked: a file bg.json does not record is the consumer's " +
        "own code, so no directory is scanned for strays",
    ],
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    return !isMissing(error);
  }
}

/** What a module's `module.json` says its patches are, for the variant `bg.json` recorded. */
type DeclaredPatches = { ok: true; patches: PlannedPatch[] } | { ok: false; reason: string };

async function declaredPatches(
  projectRoot: string,
  manifest: ProjectManifest,
  installed: InstalledModule & { category: ModuleCategory },
): Promise<DeclaredPatches> {
  const source = defaultSource(manifest);
  const lookup: ModuleManifestLookup = source
    ? await readInstalledModuleManifest(
        source,
        projectRoot,
        installed.category,
        installed.record.id,
      )
    : { found: false, reason: "bg.json declares no registry" };
  if (!lookup.found) {
    return { ok: false, reason: lookup.reason };
  }
  const variant = lookup.manifest.variants.find(({ key }) => key === installed.record.variant);
  if (variant === undefined) {
    return { ok: false, reason: `module.json has no variant ${installed.record.variant}` };
  }
  try {
    return { ok: true, patches: plannedPatches(installed.key, variant) };
  } catch (error) {
    return { ok: false, reason: reasonOf(error) };
  }
}

async function checkRegions(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<CheckReport<RegionsDetails>> {
  const details: RegionsDetails = {
    files: 0,
    regions: 0,
    checked: [],
    missing: [],
    foreignEdit: [],
    unchecked: [],
  };
  const findings: Finding[] = [];
  const notes: string[] = [];
  const declared = new Map<string, DeclaredPatches>();
  const inspections = new Map<PlannedPatch, PatchInspection>();

  for (const [file, owned] of Object.entries(manifest.regions)) {
    const entries = Object.entries(owned);
    details.files += 1;
    details.regions += entries.length;
    const exists = await pathExists(join(projectRoot, file));
    if (!exists) {
      findings.push({
        severity: "error",
        code: "region-file-missing",
        path: file,
        message: `${file} is missing, and bg.json records ${plural(entries.length, "region")} in it: ${entries.map(([region]) => region).join(", ")}`,
      });
    }
    for (const [region, owner] of entries) {
      if (!isInstalledOwner(manifest, owner)) {
        findings.push({
          severity: "error",
          code: "region-owner-unknown",
          path: file,
          message: `region ${region} of ${file} is owned by ${owner}, which is neither an installed item nor an installed module`,
        });
      }
      if (!isReadableRegion(file, region)) {
        details.unchecked.push(`${file}#${region}`);
      }
    }

    const readable = entries.filter(([region]) => isReadableRegion(file, region));
    if (!exists || readable.length === 0) {
      continue;
    }
    let text: string;
    try {
      text = await readFile(join(projectRoot, file), "utf8");
    } catch {
      continue; // a directory or an unreadable file: `files` reports it when it is a recorded one
    }
    const presences = readable.map(([region]) => regionPresence(file, text, region));
    const invalid = presences.find((presence) => presence.kind === "invalid");
    if (invalid !== undefined) {
      findings.push({
        severity: "error",
        code: "region-file-invalid",
        path: file,
        message: `${file} cannot hold its recorded regions (${invalid.reason}): ${readable.map(([region]) => region).join(", ")}`,
      });
      continue;
    }

    for (const [index, [region, owner]] of readable.entries()) {
      const id = `${file}#${region}`;
      if (presences[index]?.kind === "missing") {
        details.missing.push(id);
        findings.push({
          severity: "error",
          code: "region-missing",
          path: file,
          message: `${region} is gone from ${file}: recorded for ${owner}, and the file no longer has it`,
        });
        continue;
      }
      details.checked.push(id);

      const installed = installedModules(manifest).find(({ key }) => key === owner);
      if (installed === undefined) {
        continue; // owned by an item or by nothing installed: `region-owner-unknown` says so
      }
      let known = declared.get(owner);
      if (known === undefined) {
        known = await declaredPatches(projectRoot, manifest, installed);
        declared.set(owner, known);
        if (!known.ok) {
          notes.push(`foreign edit of ${owner}'s regions not checked: ${known.reason}`);
        }
      }
      const patch = known.ok
        ? known.patches.find(
            (candidate) =>
              candidate.file === file &&
              patchRegions(candidate).some((entry) => entry.region === region),
          )
        : undefined;
      if (patch === undefined) {
        continue;
      }
      let inspection = inspections.get(patch);
      if (inspection === undefined) {
        inspection = inspectPatch(text, patch);
        inspections.set(patch, inspection);
      }
      const state = inspection.ok ? inspection.states.get(region) : undefined;
      if (state?.kind === "differs") {
        const wanted = patchRegions(patch).find((entry) => entry.region === region)?.declared;
        details.foreignEdit.push(id);
        findings.push({
          severity: "warning",
          code: "region-foreign-edit",
          path: file,
          message:
            `${region} of ${file} is ${state.shown}, but ${owner} declares ${wanted ?? "something else"}: ` +
            "the project owns it now, and bg add will not overwrite it without --force",
        });
      }
    }
  }

  return report(
    `${plural(details.regions, "region")} in ${plural(details.files, "file")}, ${details.checked.length} read`,
    details,
    findings,
    [
      ...notes,
      "foreign edit is checked for script regions, against the module.json of the registry bg.json names " +
        "(bg.json records who owns a region, not what it contained); a region of another kind is listed " +
        "as unchecked, and nothing was compared for it",
    ],
  );
}

function checkPatches(manifest: ProjectManifest): CheckReport<PatchesDetails> {
  const details: PatchesDetails = { applied: 0, skipped: 0, failed: 0 };
  const findings: Finding[] = [];

  for (const { key, record } of installedModules(manifest)) {
    for (const patch of record.patches) {
      details[patch.status] += 1;
      if (patch.status === "failed") {
        findings.push({
          severity: "warning",
          code: "patch-failed",
          path: patch.file,
          message:
            `${key}: patch ${patch.type} on ${patch.file} failed (${patch.reason ?? "no reason recorded"}); ` +
            "it is a pending intention (spec 060): apply it by hand, then bg record",
        });
      }
    }
  }

  return report(
    `${details.applied} applied, ${details.skipped} skipped, ${details.failed} failed`,
    details,
    findings,
  );
}

async function checkIntentions(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<CheckReport<IntentionsDetails>> {
  const modules = installedModules(manifest);
  const applied = [
    ...manifest.platform.intentions.applied,
    ...modules.flatMap(({ record }) => record.intentions.applied),
  ];
  const skippedIntentions = Object.fromEntries([
    ...Object.entries(manifest.platform.intentions.skipped),
    ...modules.flatMap(({ record }) => Object.entries(record.intentions.skipped)),
  ]);
  const resolved = new Set([...applied, ...Object.keys(skippedIntentions)]);

  const { staged, unreadable } = await readStagedIntentions(projectRoot);
  const pending = staged.filter((intention) => !resolved.has(intention.id));

  const findings: Finding[] = [
    ...pending.map(
      ({ id, file }): Finding => ({
        severity: "warning",
        code: "intention-pending",
        path: file,
        message: `${id} is staged in ${file} and not recorded: apply it, then run bg record ${id} (or bg record ${id} --skip "<reason>")`,
      }),
    ),
    ...unreadable.map(
      ({ file, reason }): Finding => ({
        severity: "warning",
        code: "intention-unreadable",
        path: file,
        message: `${file} cannot be read as an intention: ${reason}`,
      }),
    ),
  ];

  return report(
    `${applied.length} applied, ${Object.keys(skippedIntentions).length} skipped, ${pending.length} pending`,
    { applied, skipped: skippedIntentions, pending },
    findings,
  );
}

async function checkPeers(
  projectRoot: string,
  manifest: ProjectManifest,
): Promise<CheckReport<PeersDetails>> {
  const details: PeersDetails = { checked: [], unchecked: [] };
  const findings: Finding[] = [];
  const notes: string[] = [];
  const source = defaultSource(manifest);

  for (const { key, record, category } of installedModules(manifest)) {
    // `peers` lives in module.json, not in the module record, so ask the registry (offline).
    const lookup: ModuleManifestLookup = source
      ? await readInstalledModuleManifest(source, projectRoot, category, record.id)
      : { found: false, reason: "bg.json declares no registry" };
    if (!lookup.found) {
      details.unchecked.push(key);
      notes.push(`peers of ${key} not checked: ${lookup.reason}`);
      continue;
    }
    details.checked.push(key);
    for (const peer of MODULE_CATEGORIES) {
      const allowed = lookup.manifest.peers[peer];
      if (allowed !== undefined && (manifest.modules[peer] ?? []).length === 0) {
        findings.push({
          severity: "error",
          code: "peer-empty",
          message: `${key} needs a ${peer} module${allowed.length > 0 ? ` (${allowed.join(" | ")})` : ""} and none is installed`,
        });
      }
    }
  }

  return report(
    `${plural(details.checked.length, "module")} checked, ${details.unchecked.length} not checked`,
    details,
    findings,
    notes,
  );
}

export async function runDoctor(projectRoot: string): Promise<DoctorReport> {
  const { check: manifestCheck, manifest } = await checkManifest(projectRoot);
  if (manifest === null) {
    const why = "bg.json cannot be used";
    return {
      status: worst([manifestCheck.status]),
      checks: {
        manifest: manifestCheck,
        files: skipped(why),
        regions: skipped(why),
        patches: skipped(why),
        intentions: skipped(why),
        peers: skipped(why),
      },
    };
  }

  const checks = {
    manifest: manifestCheck,
    files: await checkFiles(projectRoot, manifest),
    regions: await checkRegions(projectRoot, manifest),
    patches: checkPatches(manifest),
    intentions: await checkIntentions(projectRoot, manifest),
    peers: await checkPeers(projectRoot, manifest),
  };
  return { status: worst(Object.values(checks).map((check) => check.status)), checks };
}

/** Plain `doctor` fails on an error; `--strict` fails on a warning too. */
export function doctorExitCode(doctor: DoctorReport, strict: boolean): 0 | 1 {
  return doctor.status === "error" || (strict && doctor.status === "warning") ? 1 : 0;
}

export function formatDoctor(doctor: DoctorReport): string {
  const lines = ["bg doctor", ""];
  for (const [name, check] of Object.entries(doctor.checks)) {
    lines.push(`${name.padEnd(11)} ${check.status.padEnd(8)} ${check.summary}`);
    for (const finding of check.findings) {
      lines.push(`    ${finding.severity} ${finding.code}: ${finding.message}`);
    }
    for (const note of check.notes) {
      lines.push(`    note: ${note}`);
    }
  }
  lines.push("", `result: ${doctor.status}`);
  return lines.join("\n");
}
