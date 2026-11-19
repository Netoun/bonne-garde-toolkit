import { join } from "node:path";
import {
  cliRunner,
  isModuleCategory,
  type ModuleCategory,
  type ProjectManifest,
} from "@bonne-garde/schema";
import type { ModuleRef } from "./module-plan";
import type { RegistryCatalog, RegistryFile, RegistryItem } from "./types";
import { utf8Text } from "./utf8";

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

/**
 * The text of an item's file. Items are text-only: the shadcn schema holds a file as a string,
 * and `@acme` is rewritten in it, so a file that is not valid UTF-8 is refused where it would be
 * corrupted. A binary file belongs to a module.
 */
export function itemFileText(item: string, path: string, bytes: Uint8Array): string {
  const text = utf8Text(bytes);
  if (text === null) {
    throw new PlanError(
      `item ${item} ships ${path}, which is not valid UTF-8: items are text-only, and a binary file belongs to a module`,
    );
  }
  return text;
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

/** A module an item needs: any module of `category`, or the one named `id`. */
type Need = { category: ModuleCategory; id?: string };

const needLabel = (need: Need): string =>
  need.id === undefined ? need.category : `${need.category}/${need.id}`;

const NEED_SHAPE = "a module category (auth) or <category>/<id> (web/spa)";

/**
 * The modules a feature item needs: `meta.needsModules`, each entry a category or a
 * `<category>/<id>`. It carries a rule and no second naming of an edge: `registryDependencies` stays
 * the only way an item names another item, and `meta.bg` is still gone.
 */
function needsOf(item: RegistryItem): Need[] {
  const declared = item.meta?.needsModules;
  if (declared === undefined) {
    return [];
  }
  if (!Array.isArray(declared) || declared.some((entry) => typeof entry !== "string")) {
    throw new PlanError(`${item.name} declares meta.needsModules that is not a list of strings`);
  }
  return declared.map((entry: string): Need => {
    const [category, id, ...rest] = entry.split("/");
    if (
      !isModuleCategory(category) ||
      rest.length > 0 ||
      (id !== undefined && !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(id))
    ) {
      throw new PlanError(
        `${item.name} declares meta.needsModules ${JSON.stringify(entry)}: ${NEED_SHAPE}`,
      );
    }
    return id === undefined ? { category } : { category, id };
  });
}

/** Where an item's files land, which needs a module whether or not it says so: UI items go in `packages/ui`. */
const UI_HOME = { prefix: "packages/ui/", need: { category: "ui" } satisfies Need };

/** What the refusal suggests for a category when the catalog lists no module of it (a github source lists none). */
const SUGGESTED: Readonly<Partial<Record<ModuleCategory, string>>> = {
  ui: "ui/shadcn",
  auth: "auth/better-auth",
  storage: "storage/r2",
};

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

type Missing = { need: Need; needing: RegistryItem[] };

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
  missing: readonly Missing[],
): PlanError {
  const names = new Set(missing.flatMap(({ needing }) => needing.map((item) => item.name)));
  const asked = requested.filter((name) =>
    [...closureOf(catalog, name)].some((dep) => names.has(dep)),
  );
  const hosts = missing.map(({ need }) => {
    if (need.id !== undefined) {
      return needLabel(need);
    }
    const known = catalog.modules
      .filter(({ manifest: module }) => module.category === need.category)
      .map(({ manifest: module }) => `${module.category}/${module.id}`);
    return known.length > 0 ? known.join(" or ") : (SUGGESTED[need.category] ?? need.category);
  });
  const named = modules.map((ref) => `${ref.category}/${ref.id}`);
  const verb = asked.length > 1 ? "need" : "needs";
  const labels = missing.map(({ need }) => needLabel(need));
  const list =
    labels.length > 1
      ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
      : (labels[0] ?? "");
  const noun = labels.length > 1 ? "modules" : "module";
  return new PlanError(
    `${asked.join(", ")} ${verb} the ${list} ${noun}, and none is installed or named in this call; run: ${cliRunner()} add ${[...hosts, ...named, ...requested].join(" ")}`,
  );
}

const hasModule = (
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
  { category, id }: Need,
): boolean =>
  (manifest.modules[category] ?? []).some((record) => id === undefined || record.id === id) ||
  modules.some((ref) => ref.category === category && (id === undefined || ref.id === id));

/**
 * Fails when an item needs a module that is neither installed nor named in this call: the `ui`
 * module for an item that lands in its package, and every module an item names in
 * `meta.needsModules`. `requested` are the names the caller typed.
 */
function checkHostModules(
  catalog: RegistryCatalog,
  requested: string[],
  ordered: RegistryItem[],
  manifest: ProjectManifest,
  modules: readonly ModuleRef[],
): void {
  const missing: Missing[] = [];
  const need = (wanted: Need, item: RegistryItem) => {
    if (hasModule(manifest, modules, wanted)) {
      return;
    }
    const known = missing.find(({ need: other }) => needLabel(other) === needLabel(wanted));
    if (known === undefined) {
      missing.push({ need: wanted, needing: [item] });
    } else if (!known.needing.includes(item)) {
      known.needing.push(item);
    }
  };
  for (const item of ordered) {
    if ((item.files ?? []).some((file) => itemFileTarget(item, file).startsWith(UI_HOME.prefix))) {
      need(UI_HOME.need, item);
    }
  }
  for (const item of ordered) {
    for (const wanted of needsOf(item)) {
      need(wanted, item);
    }
  }
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
