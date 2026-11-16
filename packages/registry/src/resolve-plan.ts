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
 * Spec 030: an item is tier 1 and does not create what it lands in, so a module has to. One rule,
 * keyed on where the item's files land and not on a field: a UI item lands in the `ui` module's
 * package, a feature item in a front app's `features` folder and calls the auth client.
 */
type Host = {
  lands: (target: string) => boolean;
  category: ModuleCategory;
  fallback: string;
};

const HOSTS: readonly Host[] = [
  {
    lands: (target) => target.startsWith("packages/ui/"),
    category: "ui",
    fallback: "ui/shadcn",
  },
  {
    lands: (target) => /^apps\/[^/]+\/src\/features\//.test(target),
    category: "auth",
    fallback: "auth/better-auth",
  },
];

function landsIn(item: RegistryItem, host: Host): boolean {
  return (item.files ?? []).some((file) => host.lands(itemFileTarget(item, file)));
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

type MissingHost = { host: Host; needing: readonly RegistryItem[] };

/**
 * The refusal for items that need modules nobody installed or named: it names every one at once, so
 * fixing the first does not uncover the second, the requested items that need any of them, and the
 * command that fixes it, which keeps every other module the caller named and every requested item,
 * so running it again is what the caller meant.
 */
function missingModules(
  catalog: RegistryCatalog,
  requested: string[],
  modules: readonly ModuleRef[],
  missing: readonly MissingHost[],
): PlanError {
  const names = new Set(missing.flatMap(({ needing }) => needing.map((item) => item.name)));
  const asked = requested.filter((name) =>
    [...closureOf(catalog, name)].some((dep) => names.has(dep)),
  );
  const hosts = missing.map(({ host }) => {
    const known = catalog.modules
      .filter(({ manifest: module }) => module.category === host.category)
      .map(({ manifest: module }) => `${module.category}/${module.id}`);
    return known.length > 0 ? known.join(" or ") : host.fallback;
  });
  const named = modules.map((ref) => `${ref.category}/${ref.id}`);
  const verb = asked.length > 1 ? "need" : "needs";
  const categories = missing.map(({ host }) => host.category);
  const list =
    categories.length > 1
      ? `${categories.slice(0, -1).join(", ")} and ${categories.at(-1)}`
      : (categories[0] ?? "");
  const noun = categories.length > 1 ? "modules" : "module";
  return new PlanError(
    `${asked.join(", ")} ${verb} the ${list} ${noun}, and none is installed or named in this call; run: bg add ${[...hosts, ...named, ...requested].join(" ")}`,
  );
}

const hasModule = (
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
  category: ModuleCategory,
): boolean =>
  (manifest.modules[category] ?? []).length > 0 || modules.some((ref) => ref.category === category);

/**
 * Fails when an item writes into a place whose module is neither installed nor named in this
 * call. `requested` are the names the caller typed.
 */
function checkHostModules(
  catalog: RegistryCatalog,
  requested: string[],
  ordered: RegistryItem[],
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
): void {
  const missing = HOSTS.map((host) => ({
    host,
    needing: ordered.filter((item) => landsIn(item, host)),
  })).filter(
    ({ host, needing }) => needing.length > 0 && !hasModule(manifest, modules, host.category),
  );
  if (missing.length > 0) {
    throw missingModules(catalog, requested, modules, missing);
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
