import { readFile } from "node:fs/promises";
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

/** The names of the items `requested` pulls in, itself included, through `registryDependencies`. */
function closureOf(catalog: RegistryCatalog, name: string, seen = new Set<string>()): Set<string> {
  if (!seen.has(name)) {
    seen.add(name);
    const item = catalog.items.find((candidate) => candidate.name === name);
    for (const dep of item?.registryDependencies ?? []) {
      closureOf(catalog, dep, seen);
    }
  }
  return seen;
}

/**
 * The refusal for items that need a module nobody installed or named: it names the requested items
 * that need it, and the command that fixes it, which keeps every other module the caller named and
 * every requested item, so running it again is what the caller meant.
 */
function missingModule(
  catalog: RegistryCatalog,
  requested: string[],
  modules: readonly ModuleRef[],
  needing: readonly RegistryItem[],
  category: ModuleCategory,
  fallback: string,
): PlanError {
  const names = new Set(needing.map((item) => item.name));
  const asked = requested.filter((name) =>
    [...closureOf(catalog, name)].some((dep) => names.has(dep)),
  );
  const known = catalog.modules
    .filter(({ manifest: module }) => module.category === category)
    .map(({ manifest: module }) => `${module.category}/${module.id}`);
  const host = known.length > 0 ? known.join(" or ") : fallback;
  const named = modules.map((ref) => `${ref.category}/${ref.id}`);
  const verb = asked.length > 1 ? "need" : "needs";
  return new PlanError(
    `${asked.join(", ")} ${verb} the ${category} module, and none is installed or named in this call; run: bg add ${[host, ...named, ...requested].join(" ")}`,
  );
}

const hasModule = (
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
  category: ModuleCategory,
): boolean =>
  (manifest.modules[category] ?? []).length > 0 || modules.some((ref) => ref.category === category);

/**
 * Fails when an item writes into a package whose module is neither installed nor named in this
 * call. `requested` are the names the caller typed.
 */
function checkHostModules(
  catalog: RegistryCatalog,
  requested: string[],
  ordered: RegistryItem[],
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
): void {
  for (const { prefix, category, fallback } of MODULE_FOR_TARGET) {
    const needing = ordered.filter((item) => landsIn(item, prefix));
    if (needing.length > 0 && !hasModule(manifest, modules, category)) {
      throw missingModule(catalog, requested, modules, needing, category, fallback);
    }
  }
}

/**
 * Transitional. An item cannot require a module, and `spa-react-router` imports `@acme/config`, which
 * the `config/branding` module owns. Its files land in `apps/spa/`, so no target prefix says so: the
 * rule reads the imports instead, and goes when `web/spa` replaces the item and peers on `config`.
 * `@acme` is the scope placeholder items are authored with.
 */
const MODULE_FOR_IMPORT: readonly {
  specifier: RegExp;
  category: ModuleCategory;
  fallback: string;
}[] = [
  {
    specifier: /["']@acme\/config(?:\/[^"']*)?["']/,
    category: "config",
    fallback: "config/branding",
  },
];

/**
 * The twin of `checkHostModules` for what an item imports: fails when a planned item names a
 * package whose module is neither installed nor named in this call. It reads the file contents,
 * which `resolveInstallPlan` has not got for a local catalog, so it runs once the plan is made.
 */
export async function checkImportedModules(
  catalog: RegistryCatalog,
  requested: string[],
  plan: InstallPlan,
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
): Promise<void> {
  for (const { specifier, category, fallback } of MODULE_FOR_IMPORT) {
    if (hasModule(manifest, modules, category)) {
      continue;
    }
    const needing: RegistryItem[] = [];
    for (const item of plan.items) {
      for (const file of item.files ?? []) {
        if (specifier.test(file.content ?? (await readFile(file.path, "utf8")))) {
          needing.push(item);
          break;
        }
      }
    }
    if (needing.length > 0) {
      throw missingModule(catalog, requested, modules, needing, category, fallback);
    }
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
