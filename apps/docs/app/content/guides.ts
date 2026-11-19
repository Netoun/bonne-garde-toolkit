import type { NavSection } from "../nav";
import { listAdrSources, listGuideSources, type GuideSource } from "../lib/guide-source";

const toLinks = (sources: GuideSource[]) => sources.map(({ title, href }) => ({ title, href }));

export async function listGuides(): Promise<NavSection[]> {
  return [
    { title: "Guides", links: toLinks(listGuideSources()) },
    { title: "Decisions", links: toLinks(listAdrSources()) },
  ];
}
