import type { NavSection } from "../nav";

const navCacheKey = Symbol.for("bonne-garde.docs.nav");

type NavCacheGlobal = typeof globalThis & {
  [navCacheKey]?: NavSection[];
};

export function readCachedNav(): NavSection[] | undefined {
  return (globalThis as NavCacheGlobal)[navCacheKey];
}

export function writeCachedNav(sections: NavSection[]): void {
  (globalThis as NavCacheGlobal)[navCacheKey] = sections;
}
