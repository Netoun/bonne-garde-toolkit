import type { NavSection } from "../nav";
import { getCatalog } from "../lib/registry";
import { itemHref, itemNavSection, itemTitle } from "../lib/items";

const SECTION_ORDER = ["Components", "Utilities", "Blocks"] as const;

let cachedItems: NavSection[] | undefined;
let itemsPromise: Promise<NavSection[]> | undefined;

export async function listItems(): Promise<NavSection[]> {
  if (cachedItems) {
    return cachedItems;
  }
  itemsPromise ??= buildItems();
  return itemsPromise;
}

async function buildItems(): Promise<NavSection[]> {
  const catalog = await getCatalog();
  const bySection = new Map<(typeof SECTION_ORDER)[number], { title: string; href: string }[]>(
    SECTION_ORDER.map((title) => [title, []]),
  );

  const sorted = [...catalog.items].sort((a, b) => itemTitle(a).localeCompare(itemTitle(b)));
  for (const item of sorted) {
    const section = itemNavSection(item);
    if (section === null) {
      continue;
    }
    bySection.get(section)!.push({ title: itemTitle(item), href: itemHref(item) });
  }

  const sections = SECTION_ORDER.map((title) => ({ title, links: bySection.get(title)! })).filter(
    (section) => section.links.length > 0,
  );
  cachedItems = sections;
  return sections;
}
