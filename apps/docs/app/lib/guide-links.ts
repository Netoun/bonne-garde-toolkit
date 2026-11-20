import { posix } from "node:path";

import { listPublishedSources, repositoryVersion } from "./guide-source";

const REPOSITORY = "https://github.com/Netoun/bonne-garde-toolkit";

/**
 * Rewrites a link found in a published markdown file: a published file becomes its site route
 * (anchor kept), any other repository file the GitHub blob of the tag the site is published from.
 */
export function resolveGuideLink(href: string, fromFile: string): string {
  if (href.startsWith("#") || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//")) {
    return href;
  }
  const [path = "", anchor] = href.split("#", 2);
  const target = posix.join(posix.dirname(fromFile), path);
  const hash = anchor === undefined ? "" : `#${anchor}`;
  const published = listPublishedSources().find((source) => source.file === target);
  if (published) return `${published.href}${hash}`;
  return `${REPOSITORY}/blob/v${repositoryVersion()}/${target}${hash}`;
}
