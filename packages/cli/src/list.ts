import type { GithubOptions, RegistryModule } from "@bonne-garde/registry";
import { isModuleCategory, MODULE_CATEGORIES, type ModuleCategory } from "@bonne-garde/schema";
import { openCatalog } from "./add";

export type ListQuery = {
  /** `--items`: only the items, as `bg list` printed them before it knew modules. */
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

/** Spec 035 order: the category table's own, then the id, so the output does not depend on the disk. */
function inCategoryOrder(modules: RegistryModule[]): RegistryModule[] {
  return MODULE_CATEGORIES.flatMap((category) =>
    modules
      .filter(({ manifest }) => manifest.category === category)
      .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id)),
  );
}

/**
 * What `bg list` prints (spec 050): `name<TAB>type<TAB>description` for an item and
 * `<category>/<id><TAB>module<TAB>description` for a module, items first. `--items` is the items
 * alone, byte for byte what `list` printed before modules, because `scripts/golden-project.ts`
 * reads it. `notes` go to stderr.
 */
export async function listRegistry(
  projectRoot: string,
  query: ListQuery,
  github?: GithubOptions,
): Promise<{ lines: string[]; notes: string[] }> {
  if (query.itemsOnly && query.category !== undefined) {
    throw new Error("--items and --category cannot be combined: an item has no category");
  }
  const category = query.category === undefined ? undefined : parseCategory(query.category);
  const catalog = await openCatalog(projectRoot, query.source, github);

  const lines: string[] = [];
  if (category === undefined) {
    for (const item of catalog.items) {
      lines.push(`${item.name}\t${item.type}\t${item.description ?? ""}`);
    }
  }
  if (!query.itemsOnly) {
    for (const { manifest } of inCategoryOrder(catalog.modules)) {
      if (category === undefined || manifest.category === category) {
        lines.push(`${manifest.category}/${manifest.id}\tmodule\t${manifest.description}`);
      }
    }
  }

  const notes: string[] = [];
  if (!query.itemsOnly && catalog.reader !== undefined) {
    notes.push(
      `bg: modules are not listed from ${catalog.reader.label}: raw HTTP has no directory listing. \`bg add <category>/<id>\` still installs one by name.`,
    );
  }
  return { lines, notes };
}
