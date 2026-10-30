import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { FileRecord, ProjectManifest } from "@bonne-garde/schema";
import { ApplyError } from "./apply-error";
import type { ModulePlan } from "./module-plan";
import { sha256Hex } from "./sha256";
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
  /** The `files` records to merge into the manifest. */
  files: Record<string, FileRecord>;
  /** The `regions` records to merge in: one per env key a module added. */
  regions: Record<string, Record<string, string>>;
  tookOver: TookOver[];
  env: EnvResult | null;
};

type Disk = { kind: "absent" } | { kind: "file"; content: string } | { kind: "other" };

function isMissing(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error.code === "ENOENT" || error.code === "ENOTDIR")
  );
}

async function readDisk(path: string): Promise<Disk> {
  try {
    const info = await stat(path);
    return info.isFile()
      ? { kind: "file", content: await readFile(path, "utf8") }
      : { kind: "other" };
  } catch (error) {
    if (isMissing(error)) {
      return { kind: "absent" };
    }
    throw error;
  }
}

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
 * - absent: written. Identical to what would be written: skipped, whoever owns it keeps it.
 * - differs, recorded for this module and still at the recorded sha: untouched, so overwritten.
 * - differs otherwise (edited since, owned by another owner, or not recorded): a collision that
 *   `--force` overwrites, the module becoming the owner. 060's table is silent on a file owned by
 *   another module, so it follows the row for a file that differs from its recorded sha.
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
    files: {},
    regions: {},
    tookOver: [],
    env: null,
  };
  const refused: string[] = [];
  const collisions: string[] = [];

  for (const plan of plans) {
    await assertWorkspaceCovered(projectRoot, plan);
    for (const { target, content } of plan.files) {
      const rival = claimed.get(target);
      if (rival !== undefined && rival !== plan.key) {
        refused.push(`${target} is named by both ${rival} and ${plan.key} in this call`);
        continue;
      }
      claimed.set(target, plan.key);

      const sha256 = sha256Hex(content);
      const disk = await readDisk(join(projectRoot, target));
      const stage = () => {
        staging.staged.push({ path: join(projectRoot, target), content });
        staging.written.push(target);
        staging.files[target] = { owner: plan.key, sha256 };
      };

      if (disk.kind === "other") {
        refused.push(`${target} exists and is not a regular file`);
      } else if (disk.kind === "absent") {
        const recorded = manifest.files[target];
        if (recorded !== undefined && recorded.owner !== plan.key) {
          staging.tookOver.push({ path: target, from: recorded.owner, by: plan.key });
        }
        stage();
      } else if (disk.content === content) {
        staging.skippedIdentical.push(target);
        staging.files[target] = { owner: manifest.files[target]?.owner ?? plan.key, sha256 };
      } else {
        const recorded = manifest.files[target];
        if (recorded?.owner === plan.key && sha256Hex(disk.content) === recorded.sha256) {
          stage();
        } else if (force) {
          if (recorded !== undefined && recorded.owner !== plan.key) {
            staging.tookOver.push({ path: target, from: recorded.owner, by: plan.key });
          }
          stage();
        } else if (recorded === undefined) {
          collisions.push(`${target} exists and is not recorded in bg.json`);
        } else if (recorded.owner === plan.key) {
          collisions.push(`${target} was modified since ${plan.key} wrote it`);
        } else {
          collisions.push(
            `${target} is owned by ${recorded.owner}, and ${plan.key} would replace it`,
          );
        }
      }
    }
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
  staging.regions = regions;
  return staging;
}
