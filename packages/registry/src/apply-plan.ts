import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  categoryCardinality,
  parseProjectManifest,
  type ModuleRecord,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { ApplyError } from "./apply-error";
import type { ModulePlan } from "./module-plan";
import type { InstallPlan } from "./resolve-plan";
import { sha256Hex } from "./sha256";
import { stageModules, type EnvResult, type TookOver } from "./stage-module";
import { writeAllOrNothing, type StagedFile } from "./write-tree";

export { ApplyError };

export type ApplyOptions = {
  projectRoot: string;
  manifest: ProjectManifest;
  plan: InstallPlan;
  /** Modules to install in the same all-or-nothing apply, in plan order. */
  modules?: ModulePlan[];
  sourceLabel: string;
  force?: boolean;
  dryRun?: boolean;
  now?: () => string;
};

export type ApplyResult = {
  written: string[];
  skippedIdentical: string[];
  manifest: ProjectManifest;
  /** Files whose recorded owner a module changed: replaced under `--force`, or re-created after a deletion. */
  tookOver: TookOver[];
  /** What the modules' env keys did to the example env file; `null` when none declared any. */
  env: EnvResult | null;
};

function defaultTarget(itemType: string, filePath: string): string {
  const base = filePath.split("/").pop() ?? filePath;
  if (itemType === "registry:ui" || filePath.includes("/ui/")) {
    return join("packages/ui/src/components", base);
  }
  if (base === "utils.ts") {
    return join("packages/ui/src/lib", base);
  }
  return base;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Spec 020 "Module record". Re-adding the module that already fills a category replaces its record
 * rather than appending a second, and keeps the intentions recorded for it. `version` is the
 * platform version, as an item's is; there are no patches to record, since none is applied.
 */
function withModules(
  manifest: ProjectManifest,
  plans: ModulePlan[],
  installedAt: string,
): ProjectManifest["modules"] {
  const next: ProjectManifest["modules"] = { ...manifest.modules };
  for (const plan of plans) {
    const records = next[plan.category] ?? [];
    const previous = records.find((record) => record.id === plan.id);
    const record: ModuleRecord = {
      id: plan.id,
      variant: plan.variant,
      version: manifest.platform.version,
      installedAt,
      options: plan.options,
      patches: [],
      intentions: previous?.intentions ?? { applied: [], skipped: {} },
    };
    next[plan.category] =
      previous !== undefined
        ? records.map((existing) => (existing === previous ? record : existing))
        : categoryCardinality(plan.category) === "one"
          ? [record]
          : [...records, record];
  }
  return next;
}

export async function applyInstallPlan(options: ApplyOptions): Promise<ApplyResult> {
  const written: string[] = [];
  const skippedIdentical: string[] = [];
  const staged: StagedFile[] = [];
  const nextFiles = { ...options.manifest.files };
  const claimed = new Map<string, string>();

  for (const item of options.plan.items) {
    for (const file of item.files ?? []) {
      const relTarget = file.target ?? defaultTarget(item.type, file.path);
      claimed.set(relTarget, item.name);
      const absTarget = join(options.projectRoot, relTarget);
      const raw = file.content ?? (await readFile(file.path, "utf8"));
      const content = raw.split("@acme").join(options.manifest.scope);
      const sha256 = sha256Hex(content);
      if (await pathExists(absTarget)) {
        const existing = await readFile(absTarget, "utf8");
        if (existing === content) {
          skippedIdentical.push(relTarget);
          // Identical to what we would write: record it, so a re-add leaves the same record and
          // a pre-v2 file becomes tracked. Whoever owned it keeps it.
          nextFiles[relTarget] = { owner: nextFiles[relTarget]?.owner ?? item.name, sha256 };
          continue;
        }
        if (!options.force) {
          throw new ApplyError(`collision at ${relTarget} (use --force to overwrite)`);
        }
      }
      staged.push({ path: absTarget, content });
      written.push(relTarget);
      nextFiles[relTarget] = { owner: item.name, sha256 };
    }
  }

  const modules = options.modules ?? [];
  const staging = await stageModules({
    projectRoot: options.projectRoot,
    manifest: options.manifest,
    plans: modules,
    claimed,
    force: options.force ?? false,
  });
  staged.push(...staging.staged);
  written.push(...staging.written);
  skippedIdentical.push(...staging.skippedIdentical);
  Object.assign(nextFiles, staging.files);

  const installedAt = (options.now ?? (() => new Date().toISOString()))();
  const nextItems = { ...options.manifest.items };
  for (const item of options.plan.items) {
    nextItems[item.name] = {
      source: `${options.sourceLabel}/${item.name}`,
      version: options.manifest.platform.version,
      installedAt,
    };
  }
  const nextRegions = { ...options.manifest.regions };
  for (const [file, owned] of Object.entries(staging.regions)) {
    nextRegions[file] = { ...nextRegions[file], ...owned };
  }
  const nextManifest = parseProjectManifest({
    ...options.manifest,
    modules: withModules(options.manifest, modules, installedAt),
    items: nextItems,
    files: nextFiles,
    regions: nextRegions,
  });
  const result: ApplyResult = {
    written,
    skippedIdentical,
    manifest: nextManifest,
    tookOver: staging.tookOver,
    env: staging.env,
  };

  if (options.dryRun) {
    return result;
  }

  // `bg.json` goes last: a write that fails anywhere leaves the tree and the manifest as they were.
  await writeAllOrNothing([
    ...staged,
    {
      path: join(options.projectRoot, "bg.json"),
      content: `${JSON.stringify(nextManifest, null, 2)}\n`,
    },
  ]);

  return result;
}
