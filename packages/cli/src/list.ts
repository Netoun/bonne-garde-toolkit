import type { GithubOptions, RegistryModule } from "@bonne-garde/registry";
import {
  cliRunner,
  isModuleCategory,
  MODULE_CATEGORIES,
  type ModuleCategory,
} from "@bonne-garde/schema";
import { openCatalog } from "./add";
import { painter } from "./terminal";

export type ListQuery = {
  /** `--items`: only the items, as `bonne-garde list` printed them before it knew modules. */
  itemsOnly: boolean;
  /** `--category`: only the modules of this category. An item has none, so it is not a filter on items. */
  category: string | undefined;
  source: string | undefined;
  /** On a terminal only (`colorEnabled`): aligned columns and headings instead of tab-separated lines. */
  color?: boolean;
};

export type Row = { name: string; type: string; description: string };

/**
 * `list` and `search` lines. Without colour, `name<TAB>type<TAB>description`, which agents and
 * `scripts/golden-project.ts` parse. With it, the name cyan and the type dim, aligned with spaces.
 */
export function formatRows(rows: readonly Row[], { color }: { color: boolean }): string[] {
  if (!color) {
    return rows.map(({ name, type, description }) => `${name}\t${type}\t${description}`);
  }
  const paint = painter(true);
  const nameWidth = Math.max(0, ...rows.map(({ name }) => name.length));
  const typeWidth = Math.max(0, ...rows.map(({ type }) => type.length));
  return rows.map(({ name, type, description }) => {
    const columns = `${paint("cyan", name.padEnd(nameWidth))}  ${paint("dim", type.padEnd(typeWidth))}`;
    return description === "" ? columns.trimEnd() : `${columns}  ${description}`;
  });
}

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
 * What `bonne-garde list` prints: `name<TAB>type<TAB>description` for an item and
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

  // Items, then each category's modules, as the groups a terminal gets a heading over.
  const groups: { heading: string; rows: Row[] }[] = [];
  if (category === undefined) {
    groups.push({
      heading: "Items",
      rows: catalog.items.map(({ name, type, description }) => ({
        name,
        type,
        description: description ?? "",
      })),
    });
  }
  if (!query.itemsOnly) {
    for (const { manifest } of inCategoryOrder(catalog.modules)) {
      if (category === undefined || manifest.category === category) {
        const row = {
          name: `${manifest.category}/${manifest.id}`,
          type: "module",
          description: manifest.description,
        };
        const last = groups.at(-1);
        if (last !== undefined && last.heading === manifest.category) {
          last.rows.push(row);
        } else {
          groups.push({ heading: manifest.category, rows: [row] });
        }
      }
    }
  }
  const color = query.color === true;
  const formatted = formatRows(
    groups.flatMap(({ rows }) => rows),
    { color },
  );
  // Headings only with no flag: `--items` and `--category` are one group, the lines alone.
  const headed = color && category === undefined && !query.itemsOnly;
  const paint = painter(color);
  const lines: string[] = [];
  let at = 0;
  for (const { heading, rows } of groups) {
    if (headed) {
      lines.push(...(lines.length > 0 ? [""] : []), paint("bold", heading));
    }
    lines.push(...formatted.slice(at, at + rows.length));
    at += rows.length;
  }

  const notes: string[] = [];
  if (!query.itemsOnly && catalog.reader !== undefined) {
    notes.push(
      `bonne-garde: modules are not listed from ${catalog.reader.label}: raw HTTP has no directory listing. \`${cliRunner()} add <category>/<id>\` still installs one by name.`,
    );
  }
  return { lines, notes };
}
