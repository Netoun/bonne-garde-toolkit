import { readFile, stat } from "node:fs/promises";
import { join, posix } from "node:path";
import {
  categoryCardinality,
  isModuleCategory,
  MODULE_CATEGORIES,
  type ModuleCategory,
  type ModuleManifest,
  type ModuleOptionValue,
  type ModuleVariant,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { FETCH_CONCURRENCY, RegistryFileNotFoundError } from "./github-source";
import { plannedPatches, type PlannedPatch } from "./patch-plan";
import { mapLimit } from "./pool";
import { PlanError, searchCatalog } from "./resolve-plan";
import type { RegistryCatalog, RegistryModule } from "./types";

/** A module named on the command line, once classified (050 step 3). */
export type ModuleRef = { category: ModuleCategory; id: string };

export type PlannedFile = { target: string; content: string };
export type PlannedEnvKey = { name: string; required: boolean; example: string };

/** One module's share of an install plan: everything decided before any file is looked at (050 steps 4-8). */
export type ModulePlan = {
  category: ModuleCategory;
  id: string;
  /** `<category>/<id>`: the owner string `bg.json` records in `files` and `regions`. */
  key: string;
  /** The `key` of the variant selected over the installed peers. */
  variant: string;
  options: Record<string, ModuleOptionValue>;
  /** Tier 1, as it will land: paths relative to the project, content with `{{SCOPE}}` rendered. */
  files: PlannedFile[];
  env: PlannedEnvKey[];
  /** Tier 2, as declared and checked: applied in the virtual tree, after every tier-1 file is known. */
  patches: PlannedPatch[];
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  /** The workspace package `dependencies` are written into, when the variant declares one. */
  workspace: string | null;
  /** Reported, not run: 050 step 15 is not implemented. */
  checks: string[];
};

const keyOf = (ref: ModuleRef): string => `${ref.category}/${ref.id}`;

function qualifiedForms(modules: RegistryModule[]): string {
  return modules.map(({ manifest }) => keyOf(manifest)).join(", ");
}

function suggestions(catalog: RegistryCatalog, name: string): string[] {
  const needle = name.trim().toLowerCase();
  const items = searchCatalog(catalog, name).map((item) => item.name);
  const modules = catalog.modules
    .filter(({ manifest }) =>
      [keyOf(manifest), manifest.title, manifest.description]
        .join(" ")
        .toLowerCase()
        .includes(needle),
    )
    .map(({ manifest }) => keyOf(manifest));
  return [...items, ...modules];
}

/**
 * 050 step 3: item or module. `<category>/<id>` is always a module, the string `bg.json` uses as
 * owner. A bare name is an item or a module when it is exactly one of them; a bare name that is
 * both, or a module id used by two categories, fails and asks for the qualified form. Nothing
 * here resolves an ambiguity by picking a side.
 */
export function classifyNames(
  catalog: RegistryCatalog,
  names: string[],
): { items: string[]; modules: ModuleRef[] } {
  const items: string[] = [];
  const modules = new Map<string, ModuleRef>();
  const itemNames = new Set(catalog.items.map((item) => item.name));

  for (const name of names) {
    const parts = name.split("/");
    if (parts.length === 2 && parts[0] !== undefined && parts[1] !== undefined) {
      const [category, id] = parts;
      if (!isModuleCategory(category)) {
        throw new PlanError(
          `unknown category: ${category} (in ${name}); categories are ${MODULE_CATEGORIES.join(", ")}`,
        );
      }
      const found = catalog.modules.find(
        ({ manifest }) => manifest.category === category && manifest.id === id,
      );
      if (!found) {
        const siblings = catalog.modules.filter(({ manifest }) => manifest.category === category);
        throw new PlanError(
          `unknown module: ${name} (${
            catalog.reader
              ? `no modules/${category}/${id}/module.json in ${catalog.reader.label}`
              : siblings.length > 0
                ? `modules in ${category}: ${qualifiedForms(siblings)}`
                : `no modules in ${category}`
          })`,
        );
      }
      modules.set(name, { category, id });
      continue;
    }

    const named = catalog.modules.filter(({ manifest }) => manifest.id === name);
    if (itemNames.has(name) && named.length > 0) {
      throw new PlanError(
        `${name} is both an item and a module (${qualifiedForms(named)}); name the module by its qualified form`,
      );
    }
    if (named.length > 1) {
      throw new PlanError(
        `${name} names modules in ${named.length} categories (${qualifiedForms(named)}); say which one`,
      );
    }
    const [module] = named;
    if (module) {
      modules.set(keyOf(module.manifest), {
        category: module.manifest.category,
        id: module.manifest.id,
      });
    } else if (itemNames.has(name)) {
      items.push(name);
    } else {
      const near = suggestions(catalog, name);
      throw new PlanError(
        `unknown name: ${name} (${near.length > 0 ? `did you mean: ${near.join(", ")}?` : "no item or module matches"})`,
      );
    }
  }
  return { items, modules: [...modules.values()] };
}

type Present = Map<ModuleCategory, string[]>;

/** Installed modules plus the ones this call installs, by category. */
function presentModules(manifest: ProjectManifest, requested: ModuleRef[]): Present {
  const present: Present = new Map();
  const add = (category: ModuleCategory, id: string) => {
    const ids = present.get(category) ?? [];
    if (!ids.includes(id)) {
      present.set(category, [...ids, id]);
    }
  };
  for (const category of MODULE_CATEGORIES) {
    for (const record of manifest.modules[category] ?? []) {
      add(category, record.id);
    }
  }
  for (const ref of requested) {
    add(ref.category, ref.id);
  }
  return present;
}

/** 050 step 4. Only `peers` is resolved; `consumesPackages` is not read. */
function checkPeers(manifest: ModuleManifest, present: Present): void {
  const key = keyOf(manifest);
  for (const category of MODULE_CATEGORIES) {
    const allowed = manifest.peers[category];
    if (allowed === undefined) {
      continue;
    }
    const ids = present.get(category) ?? [];
    const list = allowed.length > 0 ? allowed.join(" | ") : "any";
    if (ids.length === 0) {
      throw new PlanError(
        `${key} needs a module in category ${category} (${list}) and none is installed`,
      );
    }
    if (allowed.length > 0 && !ids.some((id) => allowed.includes(id))) {
      throw new PlanError(
        `${key} accepts only ${list} for ${category}, but ${ids.map((id) => `${category}/${id}`).join(", ")} is present`,
      );
    }
  }
}

/** 050 step 5. A re-add of the module already filling its category is not a conflict. */
function checkCardinality(requested: ModuleRef[], manifest: ProjectManifest): void {
  for (const category of MODULE_CATEGORIES) {
    if (categoryCardinality(category) !== "one") {
      continue;
    }
    const named = requested.filter((ref) => ref.category === category);
    if (named.length > 1) {
      throw new PlanError(
        `${category} admits one module, but this call names ${named.map(keyOf).join(" and ")}`,
      );
    }
    const [wanted] = named;
    const installed = manifest.modules[category]?.[0];
    if (wanted && installed && installed.id !== wanted.id) {
      throw new PlanError(
        `${category} is already filled by ${category}/${installed.id}; \`bg replace ${keyOf(wanted)}\` swaps it`,
      );
    }
  }
}

function describePeers(present: Present, except: ModuleCategory): string {
  const parts = MODULE_CATEGORIES.filter((category) => category !== except).flatMap((category) =>
    (present.get(category) ?? []).map((id) => `${category}=${id}`),
  );
  return parts.length > 0 ? parts.join(", ") : "none";
}

function matchLabel(variant: ModuleVariant): string {
  const entries = Object.entries(variant.match).map(([category, id]) => `${category}=${id}`);
  return `${variant.key} {${entries.join(", ")}}`;
}

/** 050 step 7: the most specific `match` that the present peers satisfy; a tie is never broken here. */
function selectVariant(manifest: ModuleManifest, present: Present): ModuleVariant {
  const satisfied = manifest.variants.filter((variant) =>
    MODULE_CATEGORIES.every((category) => {
      const id = variant.match[category];
      return id === undefined || (present.get(category) ?? []).includes(id);
    }),
  );
  const specificity = (variant: ModuleVariant) => Object.keys(variant.match).length;
  const best = Math.max(0, ...satisfied.map(specificity));
  const top = satisfied.filter((variant) => specificity(variant) === best);
  const key = keyOf(manifest);

  const [winner] = top;
  if (!winner) {
    throw new PlanError(
      `no variant of ${key} matches the installed peers (installed: ${describePeers(present, manifest.category)}); ` +
        `variants match on: ${manifest.variants.map(matchLabel).join(", ")}`,
    );
  }
  if (top.length > 1) {
    throw new PlanError(
      `variants ${top.map((variant) => variant.key).join(" and ")} are equally specific for ${key} ` +
        `with the installed peers (${describePeers(present, manifest.category)}): a registry authoring error`,
    );
  }
  return winner;
}

/** Intentions cannot be staged yet: refused for the variant that was selected, never skipped. */
function refuseUnsupported(key: string, variant: ModuleVariant): void {
  const intents = variant.intent ?? [];
  if (intents.length > 0) {
    throw new PlanError(
      `${key} declares intentions (${intents.join(", ")}): staging them is not supported yet, and a variant is never installed with one skipped`,
    );
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

const GLOB_CHARS = /[*?[\]{}!\\]/;

/**
 * Tier 1 over the network: a `copy` entry names a file to fetch, since raw HTTP lists no directory
 * a glob could be expanded against. A glob is refused rather than skipped, as a patch is.
 */
function remoteCopyTarget(module: RegistryModule, label: string, pattern: string): string {
  const key = keyOf(module.manifest);
  if (GLOB_CHARS.test(pattern)) {
    throw new PlanError(
      `copy "${pattern}" of ${key} is a glob, and ${label} cannot expand one (raw HTTP has no directory listing): name the files in module.json, or install from a local: registry`,
    );
  }
  return pattern;
}

/** Tier 1: `copy` entries, relative to `template/`, which mirrors the target tree (spec 035). */
async function copiedFiles(
  module: RegistryModule,
  variant: ModuleVariant,
  scope: string,
): Promise<PlannedFile[]> {
  const key = keyOf(module.manifest);
  const { reader } = module;
  const targets = new Set<string>();
  if (reader) {
    for (const pattern of variant.copy ?? []) {
      targets.add(remoteCopyTarget(module, reader.label, pattern));
    }
  } else {
    const templateDir = join(module.dir, "template");
    const present = await isDirectory(templateDir);
    for (const pattern of variant.copy ?? []) {
      let matched = 0;
      if (present) {
        for await (const path of new Bun.Glob(pattern).scan({
          cwd: templateDir,
          dot: true,
          onlyFiles: true,
        })) {
          targets.add(path);
          matched += 1;
        }
      }
      if (matched === 0) {
        throw new PlanError(`copy "${pattern}" of ${key} matches no file under template/`);
      }
    }
  }

  const readTarget = async (target: string): Promise<string> => {
    if (!reader) {
      return readFile(join(module.dir, "template", target), "utf8");
    }
    const path = posix.join(module.dir, "template", target);
    try {
      return await reader.read(path);
    } catch (error) {
      if (error instanceof RegistryFileNotFoundError) {
        throw new PlanError(
          `${key} copies ${target}, which ${reader.label} does not have (no ${path}: 404)`,
        );
      }
      throw error;
    }
  };
  const sorted = [...targets].sort();
  const texts = await mapLimit(sorted, FETCH_CONCURRENCY, readTarget);
  return sorted.map((target, index) => ({
    target,
    content: (texts[index] ?? "").replaceAll("{{SCOPE}}", scope),
  }));
}

/** npm's four dependency maps: 035 declares a dependency once, in the variant, so a vendored file carries none. */
const DEPENDENCY_MAPS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sortedMap(map: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/**
 * A dependency on a sibling package of the project is named `{{SCOPE}}/<name>` in the variant, and
 * `workspace:*` is its version. Rendered here, since the key lands in a `package.json` and in what
 * `add` prints; the placeholder is only ever replaced in a name, never in a version.
 */
function renderedMap(
  map: Record<string, string> | undefined,
  scope: string,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(map ?? {}).map(([name, version]) => [
      name.replaceAll("{{SCOPE}}", scope),
      version,
    ]),
  );
}

/** The vendored `package.json`, parsed: it must be a JSON object with no dependency map (035). */
function parseVendoredPackageJson(
  key: string,
  variant: ModuleVariant,
  file: PlannedFile,
): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.content);
  } catch (error) {
    throw new PlanError(
      `${key} vendors ${file.target}, which is not valid JSON (${error instanceof Error ? error.message : String(error)}): fix the file under its template/`,
    );
  }
  if (!isRecord(parsed)) {
    throw new PlanError(
      `${key} vendors ${file.target}, which is not a JSON object: fix the file under its template/`,
    );
  }
  const carried = DEPENDENCY_MAPS.filter((map) => map in parsed);
  if (carried.length > 0) {
    throw new PlanError(
      `${key} vendors ${file.target} with ${carried.join(", ")}: spec 035 keeps dependency maps out of a vendored package.json and merges the variant's. ` +
        `Move them to variant "${variant.key}" in module.json (dependencies, devDependencies) and delete them from the file`,
    );
  }
  return parsed;
}

/**
 * The workspace `package.json` of a variant (spec 035, 050): the vendored one with the variant's
 * `dependencies` / `devDependencies` merged in, sorted, or, when the module vendors none, one
 * generated from the variant. `null` when the variant has no workspace and no dependency, and when
 * a vendored file has nothing to merge, which then lands as it was written.
 */
function workspacePackageJson(
  manifest: ModuleManifest,
  variant: ModuleVariant,
  scope: string,
  vendored: PlannedFile[],
): PlannedFile | null {
  const key = keyOf(manifest);
  const dependencies = renderedMap(variant.dependencies, scope);
  const devDependencies = renderedMap(variant.devDependencies, scope);
  const declared = Object.keys(dependencies).length + Object.keys(devDependencies).length;
  if (!variant.workspace) {
    if (declared === 0) {
      return null;
    }
    throw new PlanError(
      `${key} declares dependencies but no workspace package to hold them: spec 050 writes them into a package.json, so variant ${variant.key} needs a \`workspace\``,
    );
  }

  const target = `${variant.workspace.path}/package.json`;
  const own = vendored.find((file) => file.target === target);
  // Parsed even when there is nothing to merge: a vendored file with a map is refused either way.
  const vendoredBody = own ? parseVendoredPackageJson(key, variant, own) : null;
  if (declared === 0) {
    return null;
  }
  const base = vendoredBody ?? {
    name: variant.workspace.name.replaceAll("{{SCOPE}}", scope),
    version: manifest.version ?? "0.0.0",
    private: true,
    type: "module",
  };
  const body = {
    ...base,
    ...(Object.keys(dependencies).length > 0 ? { dependencies: sortedMap(dependencies) } : {}),
    ...(Object.keys(devDependencies).length > 0
      ? { devDependencies: sortedMap(devDependencies) }
      : {}),
  };
  return { target, content: `${JSON.stringify(body, null, 2)}\n` };
}

function resolveOptions(manifest: ModuleManifest): Record<string, ModuleOptionValue> {
  return Object.fromEntries(
    Object.entries(manifest.options ?? {}).map(([name, option]) => [name, option.default]),
  );
}

async function planModule(
  module: RegistryModule,
  present: Present,
  project: ProjectManifest,
): Promise<ModulePlan> {
  const { manifest } = module;
  const key = keyOf(manifest);
  const variant = selectVariant(manifest, present);
  const patches = plannedPatches(key, variant);
  refuseUnsupported(key, variant);

  const copied = await copiedFiles(module, variant, project.scope);
  const packageJson = workspacePackageJson(manifest, variant, project.scope, copied);
  const files = packageJson
    ? [...copied.filter((file) => file.target !== packageJson.target), packageJson]
    : copied;
  files.sort((a, b) => (a.target < b.target ? -1 : a.target > b.target ? 1 : 0));

  return {
    category: manifest.category,
    id: manifest.id,
    key,
    variant: variant.key,
    options: resolveOptions(manifest),
    files,
    patches,
    env: (variant.env ?? []).map((entry) => ({
      name: entry.name,
      required: entry.required ?? false,
      example: entry.example ?? "",
    })),
    dependencies: renderedMap(variant.dependencies, project.scope),
    devDependencies: renderedMap(variant.devDependencies, project.scope),
    workspace: variant.workspace?.path ?? null,
    checks: manifest.checks ?? [],
  };
}

/**
 * 050 steps 4-8 for modules, in category order (spec 035: topological, `provider` first), so a
 * peer named in the same call counts as installed. Reads the registry and the project manifest
 * and writes nothing.
 */
export async function resolveModulePlans(
  catalog: RegistryCatalog,
  refs: ModuleRef[],
  project: ProjectManifest,
): Promise<ModulePlan[]> {
  if (refs.length === 0) {
    return [];
  }
  const ordered = [...refs].sort(
    (a, b) => MODULE_CATEGORIES.indexOf(a.category) - MODULE_CATEGORIES.indexOf(b.category),
  );
  const modules = ordered.map((ref) => {
    const found = catalog.modules.find(
      ({ manifest }) => manifest.category === ref.category && manifest.id === ref.id,
    );
    if (!found) {
      throw new PlanError(`unknown module: ${keyOf(ref)}`);
    }
    return found;
  });

  const present = presentModules(project, ordered);
  for (const { manifest } of modules) {
    checkPeers(manifest, present);
  }
  checkCardinality(ordered, project);

  const plans: ModulePlan[] = [];
  for (const module of modules) {
    plans.push(await planModule(module, present, project));
  }
  return plans;
}
