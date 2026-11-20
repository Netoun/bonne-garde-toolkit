import { listGuides } from "./content/guides";
import { listItems } from "./content/items";
import { listModules } from "./content/modules";
import type { NavSection } from "./nav";

let navPromise: Promise<NavSection[]> | undefined;

// Server-only: the content lists read the repository, so `nav.ts` stays importable by the client.
export async function listNav(): Promise<NavSection[]> {
  navPromise ??= Promise.all([listGuides(), listItems(), listModules()]).then((sections) =>
    sections.flat(),
  );
  return navPromise;
}
