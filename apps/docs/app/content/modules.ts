import { MODULE_CATEGORIES } from "@bonne-garde/schema";

import { modulePath } from "../lib/modules";
import { loadModules } from "../lib/registry.server";
import type { NavSection } from "../nav";

export async function listModules(): Promise<NavSection[]> {
  const modules = await loadModules();
  return MODULE_CATEGORIES.flatMap((category) => {
    const links = modules
      .filter(({ manifest }) => manifest.category === category)
      .map(({ manifest }) => ({
        title: manifest.title,
        href: modulePath(category, manifest.id),
      }));
    return links.length > 0 ? [{ title: category, links }] : [];
  });
}
