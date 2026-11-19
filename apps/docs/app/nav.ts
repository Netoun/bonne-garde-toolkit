import { listGuides } from "./content/guides";
import { listItems } from "./content/items";
import { listModules } from "./content/modules";

export type NavSection = { title: string; links: { title: string; href: string }[] };

export async function listNav(): Promise<NavSection[]> {
  const sections = await Promise.all([listGuides(), listItems(), listModules()]);
  return sections.flat();
}
