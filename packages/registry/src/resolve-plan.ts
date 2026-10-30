import { join } from "node:path";
import type { ModuleCategory, ProjectManifest } from "@bonne-garde/schema";
import type { ModuleRef } from "./module-plan";
import type { RegistryCatalog, RegistryFile, RegistryItem } from "./types";

export type InstallPlan = {
  items: RegistryItem[];
  npmDependencies: string[];
  npmDevDependencies: string[];
};

export class PlanError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PlanError";
  }
}

/** Where `add` writes an item's file: its `target`, or the place its type implies. */
export function itemFileTarget(item: RegistryItem, file: RegistryFile): string {
  if (file.target !== undefined) {
    return file.target;
  }
  const base = file.path.split("/").pop() ?? file.path;
  if (item.type === "registry:ui" || file.path.includes("/ui/")) {
    return join("packages/ui/src/components", base);
  }
  if (base === "utils.ts") {
    return join("packages/ui/src/lib", base);
  }
  return base;
}

/**
 * Spec 030: an item is tier 1 and does not create the package it lands in, so a module has to. One
 * rule, keyed on where the item's files land and not on a field: the first matching prefix wins.
 */
const MODULE_FOR_TARGET: readonly { prefix: string; category: ModuleCategory; fallback: string }[] =
  [{ prefix: "packages/ui/", category: "ui", fallback: "ui/shadcn" }];

function landsIn(item: RegistryItem, prefix: string): boolean {
  return (item.files ?? []).some((file) => itemFileTarget(item, file).startsWith(prefix));
}

/**
 * Fails when an item writes into a package whose module is neither installed nor named in this
 * call. `requested` are the names the caller typed: the error names the ones that need the module
 * and the command to run, which keeps all of them.
 */
function checkHostModules(
  catalog: RegistryCatalog,
  requested: string[],
  ordered: RegistryItem[],
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
): void {
  const byName = new Map(catalog.items.map((item) => [item.name, item]));
  const closure = (name: string, seen = new Set<string>()): Set<string> => {
    if (!seen.has(name)) {
      seen.add(name);
      for (const dep of byName.get(name)?.registryDependencies ?? []) {
        closure(dep, seen);
      }
    }
    return seen;
  };

  for (const { prefix, category, fallback } of MODULE_FOR_TARGET) {
    const needing = ordered.filter((item) => landsIn(item, prefix));
    if (
      needing.length === 0 ||
      (manifest.modules[category] ?? []).length > 0 ||
      modules.some((ref) => ref.category === category)
    ) {
      continue;
    }
    const names = new Set(needing.map((item) => item.name));
    const asked = requested.filter((name) => [...closure(name)].some((dep) => names.has(dep)));
    const known = catalog.modules
      .filter(({ manifest: module }) => module.category === category)
      .map(({ manifest: module }) => `${module.category}/${module.id}`);
    const host = known.length > 0 ? known.join(" or ") : fallback;
    const verb = asked.length > 1 ? "need" : "needs";
    throw new PlanError(
      `${asked.join(", ")} ${verb} the ${category} module, and none is installed or named in this call; run: bg add ${host} ${requested.join(" ")}`,
    );
  }
}

export function resolveInstallPlan(
  catalog: RegistryCatalog,
  requestedNames: string[],
  manifest: ProjectManifest,
  requestedModules: readonly ModuleRef[] = [],
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
    if (manifest.items[name] && !rootRequested.has(name)) {
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

  checkHostModules(catalog, requestedNames, ordered, manifest, requestedModules);

  const npmDependencies = new Set<string>();
  const npmDevDependencies = new Set<string>();
  for (const item of ordered) {
    for (const dep of item.dependencies ?? []) {
      npmDependencies.add(dep);
    }
    for (const dep of item.devDependencies ?? []) {
      npmDevDependencies.add(dep);
    }
  }

  return {
    items: ordered,
    npmDependencies: [...npmDependencies].sort(),
    npmDevDependencies: [...npmDevDependencies].sort(),
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
