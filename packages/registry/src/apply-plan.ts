import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parseProjectManifest, type ProjectManifest } from "@bonne-garde/schema";
import type { InstallPlan } from "./resolve-plan";

export type ApplyOptions = {
  projectRoot: string;
  manifest: ProjectManifest;
  plan: InstallPlan;
  sourceLabel: string;
  force?: boolean;
  dryRun?: boolean;
  now?: () => string;
};

export type ApplyResult = {
  written: string[];
  skippedIdentical: string[];
  manifest: ProjectManifest;
};

export class ApplyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ApplyError";
  }
}

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

function sha256Hex(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

export async function applyInstallPlan(options: ApplyOptions): Promise<ApplyResult> {
  const written: string[] = [];
  const skippedIdentical: string[] = [];
  const staged: Array<{ abs: string; content: string }> = [];
  const nextFiles = { ...options.manifest.files };

  for (const item of options.plan.items) {
    for (const file of item.files ?? []) {
      const relTarget = file.target ?? defaultTarget(item.type, file.path);
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
      staged.push({ abs: absTarget, content });
      written.push(relTarget);
      nextFiles[relTarget] = { owner: item.name, sha256 };
    }
  }

  const installedAt = (options.now ?? (() => new Date().toISOString()))();
  const nextItems = { ...options.manifest.items };
  for (const item of options.plan.items) {
    nextItems[item.name] = {
      source: `${options.sourceLabel}/${item.name}`,
      version: options.manifest.platform.version,
      installedAt,
    };
  }
  const nextManifest = parseProjectManifest({
    ...options.manifest,
    items: nextItems,
    files: nextFiles,
  });

  if (options.dryRun) {
    return { written, skippedIdentical, manifest: nextManifest };
  }

  for (const file of staged) {
    await mkdir(dirname(file.abs), { recursive: true });
    await writeFile(file.abs, file.content, "utf8");
  }
  await writeFile(
    join(options.projectRoot, "bg.json"),
    `${JSON.stringify(nextManifest, null, 2)}\n`,
    "utf8",
  );

  return { written, skippedIdentical, manifest: nextManifest };
}
