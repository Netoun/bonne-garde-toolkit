import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { FileRecord, ProjectManifest } from "@bonne-garde/schema";
import { ApplyError } from "./apply-error";
import { isMissing, readDisk } from "./disk";
import type { ModulePlan } from "./module-plan";
import { sha256Hex } from "./sha256";
import type { PendingIntention } from "./pending-intentions";
import { ownVersion, stagePatches, type PatchReport } from "./stage-patches";
import type { StagedFile } from "./write-tree";

/**
 * The one file every module's `env` keys are merged into. Spec 035 says `.dev.vars.example` /
 * `.env.example` and gives no rule for choosing; a fixed name keeps provider technology out of the
 * CLI (035: a category, and so the code that handles it, names no provider's tooling).
 */
export const ENV_EXAMPLE_FILE = ".env.example";
const ENV_KEY = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/;

/** A file whose recorded owner changed because another owner now writes it. */
export type TookOver = { path: string; from: string; by: string };
export type EnvResult = {
  file: string;
  added: { name: string; owner: string }[];
  /** Keys already in the file, left as they were. */
  present: string[];
};

export type ModuleStaging = {
  staged: StagedFile[];
  written: string[];
  skippedIdentical: string[];
  /** Tier-1 files left as the project has them: they carry recorded regions, so only their regions are classified. */
  kept: string[];
  /** The `files` records to merge into the manifest. */
  files: Record<string, FileRecord>;
  /** The `regions` records to merge in: one per env key a module added, one per script a patch wrote or found. */
  regions: Record<string, Record<string, string>>;
  tookOver: TookOver[];
  env: EnvResult | null;
  /** What each tier-2 patch did, in plan order. */
  patches: PatchReport[];
  /** The pending intentions the failed patches became (060 "Degradation"), resolved ones included. */
  pending: PendingIntention[];
};

/** Workspace globs of the root `package.json`: the array form or `{ packages: [...] }`. */
async function rootWorkspaces(projectRoot: string): Promise<string[]> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(join(projectRoot, "package.json"), "utf8")) as unknown;
  } catch (error) {
    if (isMissing(error)) {
      return [];
    }
    throw error;
  }
  const workspaces =
    typeof parsed === "object" && parsed !== null && "workspaces" in parsed
      ? parsed.workspaces
      : [];
  const globs = Array.isArray(workspaces)
    ? workspaces
    : typeof workspaces === "object" && workspaces !== null && "packages" in workspaces
      ? workspaces.packages
      : [];
  return Array.isArray(globs)
    ? globs.filter((glob): glob is string => typeof glob === "string")
    : [];
}

/** A package registered nowhere is not a workspace, and registering it is a `workspace.add` patch. */
async function assertWorkspaceCovered(projectRoot: string, plan: ModulePlan): Promise<void> {
  if (plan.workspace === null) {
    return;
  }
  const globs = await rootWorkspaces(projectRoot);
  const path = plan.workspace;
  if (!globs.some((glob) => new Bun.Glob(glob).match(path))) {
    throw new ApplyError(
      `${plan.key}: workspace ${path} is not covered by the workspaces of package.json ` +
        `(${globs.length > 0 ? globs.join(", ") : "none"}): registering it is a workspace.add patch, which is not supported yet`,
    );
  }
}

async function stageEnv(
  projectRoot: string,
  plans: ModulePlan[],
  claimed: Map<string, string>,
  staged: StagedFile[],
): Promise<{ env: EnvResult | null; regions: ModuleStaging["regions"] }> {
  if (plans.every((plan) => plan.env.length === 0)) {
    return { env: null, regions: {} };
  }
  const tierOneOwner = claimed.get(ENV_EXAMPLE_FILE);
  if (tierOneOwner !== undefined) {
    throw new ApplyError(
      `${ENV_EXAMPLE_FILE} is a file of ${tierOneOwner}, and a module's env keys are merged into it: refusing to do both in one call`,
    );
  }
  const path = join(projectRoot, ENV_EXAMPLE_FILE);
  const disk = await readDisk(path);
  if (disk.kind === "other") {
    throw new ApplyError(`${ENV_EXAMPLE_FILE} exists and is not a regular file`);
  }
  const existing = disk.kind === "file" ? disk.content : "";
  const known = new Set(
    existing.split("\n").flatMap((line) => {
      const name = ENV_KEY.exec(line)?.[1];
      return name === undefined ? [] : [name];
    }),
  );

  const added: EnvResult["added"] = [];
  const present: string[] = [];
  const lines: string[] = [];
  for (const plan of plans) {
    for (const { name, example } of plan.env) {
      if (known.has(name)) {
        if (!present.includes(name)) {
          present.push(name);
        }
        continue;
      }
      known.add(name);
      lines.push(`${name}=${example}`);
      added.push({ name, owner: plan.key });
    }
  }
  if (lines.length === 0) {
    return { env: { file: ENV_EXAMPLE_FILE, added, present }, regions: {} };
  }
  const head = existing === "" || existing.endsWith("\n") ? existing : `${existing}\n`;
  staged.push({ path, content: `${head}${lines.join("\n")}\n` });
  return {
    env: { file: ENV_EXAMPLE_FILE, added, present },
    regions: {
      [ENV_EXAMPLE_FILE]: Object.fromEntries(added.map(({ name, owner }) => [name, owner])),
    },
  };
}

/**
 * 050 steps 10-11 for modules: classify every target against `files` (spec 060), then stage the
 * writes. Nothing touches the disk here. A path the call cannot decide on fails for every module at
 * once, listing all of them, so one run shows everything in the way.
 *
 * Tier 2 is computed first, in the virtual tree: a patch edits the file a module writes in this call,
 * or the file on disk, so a file is classified by what it will finally hold.
 *
 * - absent: written. Identical to what would be written: skipped, whoever owns it keeps it.
 * - differs, recorded for this module and still at the recorded sha: untouched, so overwritten.
 * - differs otherwise (edited since, owned by another owner, or not recorded): a collision that
 *   `--force` overwrites, the module becoming the owner. 060's table is silent on a file owned by
 *   another module, so it follows the row for a file that differs from its recorded sha.
 * - differs and carries regions of another module: rewriting would drop them, so refused, `--force`
 *   or not (060: a region owned by another module is an error always).
 * - recorded for this module, carrying recorded regions of any module, and changed since it was
 *   written: kept. Patches are computed on the file as it is, so what is classified is the regions
 *   this call writes and nothing else; `--force` overwrites a differing region, never the rest.
 * - named by an item and a module, or by two modules, in the same call, or not a regular file:
 *   refused, `--force` or not. Nothing says which of two claimants should win.
 */
export async function stageModules(options: {
  projectRoot: string;
  manifest: ProjectManifest;
  plans: ModulePlan[];
  /** Target path to owner, for what the items of this call already stage. */
  claimed: Map<string, string>;
  force: boolean;
}): Promise<ModuleStaging> {
  const { projectRoot, manifest, plans, claimed, force } = options;
  const staging: ModuleStaging = {
    staged: [],
    written: [],
    skippedIdentical: [],
    kept: [],
    files: {},
    regions: {},
    tookOver: [],
    env: null,
    patches: [],
    pending: [],
  };
  const refused: string[] = [];
  const collisions: string[] = [];

  // Who writes what, whole: a path two claimants name is refused, and every other target is kept.
  const owners = new Map<string, string>();
  let contents = new Map<string, string>();
  for (const plan of plans) {
    await assertWorkspaceCovered(projectRoot, plan);
    for (const { target, content } of plan.files) {
      const rival = claimed.get(target);
      if (rival !== undefined && rival !== plan.key) {
        refused.push(`${target} is named by both ${rival} and ${plan.key} in this call`);
        continue;
      }
      claimed.set(target, plan.key);
      owners.set(target, plan.key);
      contents.set(target, content);
    }
  }

  const templates = new Map(contents);
  const stagePatchesOn = (tierOne: Map<string, string>) =>
    stagePatches({ projectRoot, manifest, plans, tierOne, claimed, force });
  let patches = await stagePatchesOn(contents);

  // A tier-1 file that carries recorded regions and that the project changed since the module wrote
  // it is the project's: it is not rewritten, and the patches run on it as it is. Whether it is such
  // a file is only known against what the patches make of the template (a file that is already that
  // is skipped), so the patches run a second time, on the project's text, when there is one.
  const kept = new Map<string, string>();
  for (const [target, content] of contents) {
    const recorded = manifest.files[target];
    if (
      recorded === undefined ||
      recorded.owner !== owners.get(target) ||
      Object.keys(manifest.regions[target] ?? {}).length === 0
    ) {
      continue;
    }
    const disk = await readDisk(join(projectRoot, target));
    if (
      disk.kind === "file" &&
      disk.content !== content &&
      sha256Hex(disk.content) !== recorded.sha256
    ) {
      kept.set(target, disk.content);
    }
  }
  if (kept.size > 0) {
    contents = new Map([...templates, ...kept]);
    patches = await stagePatchesOn(contents);
  }
  staging.patches = patches.reports;
  staging.pending = patches.pending;
  staging.regions = patches.regions;
  refused.push(...patches.refused);
  collisions.push(...patches.collisions);

  for (const [target, content] of contents) {
    const owner = owners.get(target) ?? "";
    // What the owner wrote: the template and its own patches, and no other module's (`ownVersion`).
    // A patch of another module rewrites the file whether it runs in this call or a later one, so
    // the record has to be the same either way. Recorded after those patches, the file would count
    // as untouched the next time the owner is added alone, and the add would be refused (the regions
    // of others) or would overwrite a project's edit.
    const plan = plans.find(({ key }) => key === owner);
    const sha256 = sha256Hex(
      plan === undefined ? content : ownVersion(plan, target, templates.get(target) ?? content),
    );
    const disk = await readDisk(join(projectRoot, target));
    const stage = () => {
      staging.staged.push({ path: join(projectRoot, target), content });
      staging.written.push(target);
      staging.files[target] = { owner, sha256 };
    };

    if (kept.has(target)) {
      if (kept.get(target) === content) {
        staging.kept.push(target);
      } else {
        stage();
      }
    } else if (disk.kind === "other") {
      refused.push(`${target} exists and is not a regular file`);
    } else if (disk.kind === "absent") {
      const recorded = manifest.files[target];
      if (recorded !== undefined && recorded.owner !== owner) {
        staging.tookOver.push({ path: target, from: recorded.owner, by: owner });
      }
      stage();
    } else if (disk.content === content) {
      staging.skippedIdentical.push(target);
      staging.files[target] = { owner: manifest.files[target]?.owner ?? owner, sha256 };
    } else {
      const foreign = Object.entries(manifest.regions[target] ?? {}).filter(
        ([, regionOwner]) => regionOwner !== owner,
      );
      const recorded = manifest.files[target];
      if (foreign.length > 0) {
        const names = foreign.map(([region]) => region).join(", ");
        const others = [...new Set(foreign.map(([, regionOwner]) => regionOwner))].join(", ");
        refused.push(
          `${target} carries ${names}, owned by ${others}; writing ${owner}'s version would drop ${foreign.length === 1 ? "it" : "them"}`,
        );
      } else if (recorded?.owner === owner && sha256Hex(disk.content) === recorded.sha256) {
        stage();
      } else if (force) {
        if (recorded !== undefined && recorded.owner !== owner) {
          staging.tookOver.push({ path: target, from: recorded.owner, by: owner });
        }
        stage();
      } else if (recorded === undefined) {
        collisions.push(`${target} exists and is not recorded in bg.json`);
      } else if (recorded.owner === owner) {
        collisions.push(`${target} was modified since ${owner} wrote it`);
      } else {
        collisions.push(`${target} is owned by ${recorded.owner}, and ${owner} would replace it`);
      }
    }
  }

  // A patch on a module file is computed on the template, so it always "applies" there. When the
  // result is what the disk already holds, the regions were present and equal: 060 says skipped.
  for (const report of staging.patches) {
    if (report.status === "applied" && staging.skippedIdentical.includes(report.file)) {
      report.status = "skipped";
      report.regions = report.regions.map(({ region }) => ({ region, status: "skipped" }));
    }
  }

  // A file a patch edits that no module writes: it goes to disk whole, and `files` does not own it.
  for (const [file, content] of patches.patched) {
    staging.staged.push({ path: join(projectRoot, file), content });
  }

  if (refused.length > 0) {
    throw new ApplyError(
      `nothing was written; --force does not change this:\n  ${refused.join("\n  ")}`,
    );
  }
  if (collisions.length > 0) {
    throw new ApplyError(
      `nothing was written; ${collisions.length === 1 ? "this file is" : "these files are"} in the way (use --force to overwrite):\n  ${collisions.join("\n  ")}`,
    );
  }

  const { env, regions } = await stageEnv(projectRoot, plans, claimed, staging.staged);
  staging.env = env;
  for (const [file, owned] of Object.entries(regions)) {
    staging.regions[file] = { ...staging.regions[file], ...owned };
  }
  return staging;
}
