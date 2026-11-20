import { isModuleCategory } from "@bonne-garde/schema";
import type { RegistryCatalog, RegistryItem } from "@bonne-garde/registry";

export function itemHref(item: Pick<RegistryItem, "name" | "type">): string {
  const base = item.type === "registry:block" ? "/blocks" : "/components";
  return `${base}/${item.name}`;
}

export function itemNavSection(
  item: Pick<RegistryItem, "type">,
): "Components" | "Utilities" | "Blocks" | null {
  if (item.type === "registry:block") {
    return "Blocks";
  }
  if (item.type === "registry:ui") {
    return "Components";
  }
  if (item.type === "registry:lib" || item.type === "registry:hook") {
    return "Utilities";
  }
  return null;
}

export function itemTitle(item: Pick<RegistryItem, "title" | "name">): string {
  return item.title ?? item.name;
}

export function moduleNeedHref(catalog: RegistryCatalog, entry: string): string {
  const [category, id, ...rest] = entry.split("/");
  if (!isModuleCategory(category) || rest.length > 0) {
    throw new Error(`invalid needsModules entry: ${entry}`);
  }
  if (id !== undefined) {
    return `/modules/${category}/${id}`;
  }
  const mods = catalog.modules
    .filter((mod) => mod.manifest.category === category)
    .sort((a, b) => a.manifest.id.localeCompare(b.manifest.id));
  const first = mods[0];
  if (!first) {
    throw new Error(`no module in category ${category}`);
  }
  return `/modules/${first.manifest.category}/${first.manifest.id}`;
}
