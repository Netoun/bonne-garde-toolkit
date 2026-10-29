import type { ProjectManifest } from "@bonne-garde/schema";
import type { RegistryCatalog, RegistryItem } from "./types";

export type InstallPlan = {
  items: RegistryItem[];
  capabilities: string[];
  npmDependencies: string[];
  npmDevDependencies: string[];
  transforms: string[];
};

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

function itemCapabilities(item: RegistryItem): {
  provides: string[];
  requires: string[];
  conflicts: string[];
  transforms: string[];
} {
  const bg = item.meta?.bg;
  return {
    provides: bg?.provides ?? [],
    requires: bg?.requires ?? [],
    conflicts: bg?.conflicts ?? [],
    transforms: bg?.transforms ?? [],
  };
}

export function resolveInstallPlan(
  catalog: RegistryCatalog,
  requestedNames: string[],
  manifest: ProjectManifest,
): InstallPlan {
  const byName = new Map(catalog.items.map((item) => [item.name, item]));
  const ordered: RegistryItem[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();
  const rootRequested = new Set(requestedNames);

  const visit = (name: string) => {
    if (visited.has(name)) {
      return;
    }
    // Skip already-installed transitive deps; re-include explicitly requested items for idempotent checks.
    if (manifest.installed[name] && !rootRequested.has(name)) {
      return;
    }
    if (visiting.has(name)) {
      throw new PlanError(`circular registryDependencies involving ${name}`);
    }
    const item = byName.get(name);
    if (!item) {
      throw new PlanError(`unknown registry item: ${name}`);
    }
    visiting.add(name);
    for (const dep of item.registryDependencies ?? []) {
      visit(dep);
    }
    visiting.delete(name);
    visited.add(name);
    ordered.push(item);
  };

  for (const name of requestedNames) {
    visit(name);
  }

  const existingCaps = new Set(manifest.capabilities ?? []);
  const plannedCaps = new Set(existingCaps);
  const transforms: string[] = [];
  const npmDependencies = new Set<string>();
  const npmDevDependencies = new Set<string>();

  for (const item of ordered) {
    const meta = itemCapabilities(item);
    for (const conflict of meta.conflicts) {
      if (plannedCaps.has(conflict) || ordered.some((i) => i.name === conflict)) {
        throw new PlanError(`item ${item.name} conflicts with ${conflict}`);
      }
    }
    for (const req of meta.requires) {
      if (
        !plannedCaps.has(req) &&
        !ordered.some((i) => itemCapabilities(i).provides.includes(req))
      ) {
        throw new PlanError(`item ${item.name} requires capability ${req}`);
      }
    }
    for (const cap of meta.provides) {
      plannedCaps.add(cap);
    }
    for (const t of meta.transforms) {
      transforms.push(t);
    }
    for (const dep of item.dependencies ?? []) {
      npmDependencies.add(dep);
    }
    for (const dep of item.devDependencies ?? []) {
      npmDevDependencies.add(dep);
    }
  }

  return {
    items: ordered,
    capabilities: [...plannedCaps].sort(),
    npmDependencies: [...npmDependencies].sort(),
    npmDevDependencies: [...npmDevDependencies].sort(),
    transforms: [...new Set(transforms)],
  };
}

export function searchCatalog(catalog: RegistryCatalog, query: string): RegistryItem[] {
  const q = query.trim().toLowerCase();
  if (!q) {
    return catalog.items;
  }
  return catalog.items.filter((item) => {
    const hay = [item.name, item.title, item.description, item.type]
      .filter((v): v is string => typeof v === "string")
      .join(" ")
      .toLowerCase();
    return hay.includes(q);
  });
}
