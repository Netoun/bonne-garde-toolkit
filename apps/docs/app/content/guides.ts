import type { NavSection } from "../nav";
import {
  listAdrSources,
  listGuideSources,
  listUserGuideSources,
  type GuideSource,
} from "../lib/guide-source";

const toLinks = (sources: GuideSource[]) => sources.map(({ title, href }) => ({ title, href }));

export async function listGuides(): Promise<NavSection[]> {
  const userGuides = listUserGuideSources();
  const sections: NavSection[] = [];

  if (userGuides.length > 0) {
    sections.push({ title: "Guides", links: toLinks(userGuides) });
  }

  sections.push(
    { title: "Internals", links: toLinks(listGuideSources()) },
    { title: "Decisions", links: toLinks(listAdrSources()) },
  );

  return sections;
}
