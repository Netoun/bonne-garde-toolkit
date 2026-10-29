import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  applyInstallPlan,
  loadRegistryFromSource,
  resolveInstallPlan,
  searchCatalog,
} from "@bonne-garde/registry";
import { parseProjectManifest, type ProjectManifest } from "@bonne-garde/schema";

async function loadManifest(projectRoot: string): Promise<ProjectManifest> {
  const raw = JSON.parse(await readFile(join(projectRoot, "bg.json"), "utf8")) as unknown;
  return parseProjectManifest(raw);
}

function defaultSource(manifest: ProjectManifest): string {
  return manifest.registries["@bg"] ?? Object.values(manifest.registries)[0] ?? "";
}

async function resolveSource(projectRoot: string, source?: string): Promise<string> {
  if (source) {
    return source;
  }
  const manifest = await loadManifest(projectRoot);
  const fromManifest = defaultSource(manifest);
  if (!fromManifest) {
    throw new Error("no registry configured in bg.json (pass --source)");
  }
  return fromManifest;
}

export async function listItems(projectRoot: string, source?: string) {
  const resolved = await resolveSource(projectRoot, source);
  const catalog = await loadRegistryFromSource(resolved, projectRoot);
  return catalog.items;
}

export async function searchItems(projectRoot: string, query: string, source?: string) {
  const resolved = await resolveSource(projectRoot, source);
  const catalog = await loadRegistryFromSource(resolved, projectRoot);
  return searchCatalog(catalog, query);
}

export async function viewItem(projectRoot: string, name: string, source?: string) {
  const items = await listItems(projectRoot, source);
  const item = items.find((i) => i.name === name);
  if (!item) {
    throw new Error(`unknown item: ${name}`);
  }
  return item;
}

export type AddOptions = {
  projectRoot?: string;
  items: string[];
  source?: string;
  dryRun?: boolean;
  force?: boolean;
  install?: boolean;
};

export async function addItems(options: AddOptions) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const manifest = await loadManifest(projectRoot);
  const source = options.source ?? defaultSource(manifest);
  if (!source) {
    throw new Error("no registry configured in bg.json");
  }
  if (parseRegistryIsGithub(source)) {
    throw new Error(
      "github registries are supported for list/view index fetch; file install requires a local: registry in MVP",
    );
  }
  const catalog = await loadRegistryFromSource(source, projectRoot);
  const plan = resolveInstallPlan(catalog, options.items, manifest);
  const { dryRun = false, force = false } = options;
  const result = await applyInstallPlan({
    projectRoot,
    manifest,
    plan,
    sourceLabel: source.startsWith("local:") ? "@bg" : source,
    dryRun,
    force,
  });

  if (
    !dryRun &&
    options.install !== false &&
    plan.npmDependencies.length + plan.npmDevDependencies.length > 0
  ) {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: projectRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error("bun install failed after add");
    }
  }

  return { plan, result };
}

function parseRegistryIsGithub(source: string): boolean {
  return source.startsWith("github:") || /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+/.test(source);
}
