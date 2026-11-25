import type { GithubOptions, RegistryItem, RegistryModule } from "@bonne-garde/registry";
import {
  cliRunner,
  isModuleCategory,
  MODULE_CATEGORIES,
  type ModuleCategory,
} from "@bonne-garde/schema";
import { openCatalog } from "./add";

export type ListQuery = {
  /** `--items`: only the items, as `bonne-garde list` printed them before it knew modules. */
  itemsOnly: boolean;
  /** `--category`: only the modules of this category. An item has none, so it is not a filter on items. */
  category: string | undefined;
  source: string | undefined;
};

function parseCategory(value: string): ModuleCategory {
  if (!isModuleCategory(value)) {
    throw new Error(`unknown category: ${value} (categories are ${MODULE_CATEGORIES.join(", ")})`);
  }
  return value;
}

/** Category order (`MODULE_CATEGORIES`), then the id, so the output does not depend on the disk. */
function inCategoryOrder(modules: RegistryModule[]): RegistryModule[] {
  return MODULE_CATEGORIES.flatMap((category) =>
    modules
      .filter(({ manifest }) => manifest.category === category)
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
  );
}

/**
 * What `bonne-garde list` shows: the items, then the modules in category order. `--items` is the
 * items alone, `--category` the modules of one category. `notes` go to stderr.
 */
export async function listCatalog(
  projectRoot: string,
  query: ListQuery,
  github?: GithubOptions,
): Promise<{ items: RegistryItem[]; modules: RegistryModule[]; rootDir: string; notes: string[] }> {
  if (query.itemsOnly && query.category !== undefined) {
    throw new Error("--items and --category cannot be combined: an item has no category");
  }
  const category = query.category === undefined ? undefined : parseCategory(query.category);
  const catalog = await openCatalog(projectRoot, query.source, github);

  const items = category === undefined ? catalog.items : [];
  const modules = query.itemsOnly
    ? []
    : inCategoryOrder(catalog.modules).filter(
        ({ manifest }) => category === undefined || manifest.category === category,
      );

  const notes: string[] = [];
  if (!query.itemsOnly && catalog.reader !== undefined) {
    notes.push(
      `bonne-garde: modules are not listed from ${catalog.reader.label}: raw HTTP has no directory listing. \`${cliRunner()} add <category>/<id>\` still installs one by name.`,
    );
  }
  return { items, modules, rootDir: catalog.rootDir, notes };
}

/**
 * What a pipe gets: `name<TAB>type<TAB>description` for an item and
 * `<category>/<id><TAB>module<TAB>description` for a module, items first. `--items` is the items
 * alone, byte for byte what `list` printed before modules, because `scripts/golden-project.ts`
 * reads it.
 */
export async function listRegistry(
  projectRoot: string,
  query: ListQuery,
  github?: GithubOptions,
): Promise<{ lines: string[]; notes: string[] }> {
  const { items, modules, notes } = await listCatalog(projectRoot, query, github);
  return {
    lines: [
      ...items.map((item) => `${item.name}\t${item.type}\t${item.description ?? ""}`),
      ...modules.map(
        ({ manifest }) => `${manifest.category}/${manifest.id}\tmodule\t${manifest.description}`,
      ),
    ],
    notes,
  };
}
