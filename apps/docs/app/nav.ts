import { listGuides } from "./content/guides";
import { listItems } from "./content/items";
import { listModules } from "./content/modules";

export type NavSection = { title: string; links: { title: string; href: string }[] };

let navPromise: Promise<NavSection[]> | undefined;

export async function listNav(): Promise<NavSection[]> {
  navPromise ??= Promise.all([listGuides(), listItems(), listModules()]).then((sections) =>
    sections.flat(),
  );
  return navPromise;
}
