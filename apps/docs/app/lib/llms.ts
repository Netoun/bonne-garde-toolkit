import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join as joinPath } from "node:path";

import type { NavSection } from "../nav";
import { listNav } from "../nav.server";
import { listPublishedSources, type GuideSource } from "./guide-source";
import { resolveGuideLink } from "./guide-links";
import { itemHref, itemTitle } from "./items";
import { modulePath } from "./modules";
import { getCatalog as loadRegistryCatalog } from "./registry";
import { loadModules } from "./registry.server";

const MARKDOWN_LINK = /\]\(([^)\s]+)\)/g;

export const LLMS_TITLE = "Bonne Garde";
export const LLMS_SUMMARY =
  "Toolkit to scaffold a monorepo with `bg create` and add UI, blocks and full-stack modules with `bg add`.";

/** Absolute site URL from a base path that always starts and ends with `/` and a repo-relative path. */
export function joinBasePath(basePath: string, path: string): string {
  const baseSegments = basePath.split("/").filter(Boolean);
  const pathSegments = path.split("/").filter(Boolean);
  if (baseSegments.length === 0 && pathSegments.length === 0) return "/";
  return `/${[...baseSegments, ...pathSegments].join("/")}`;
}

function splitHash(url: string): { path: string; hash: string } {
  const hash = url.indexOf("#");
  if (hash === -1) return { path: url, hash: "" };
  return { path: url.slice(0, hash), hash: url.slice(hash) };
}

function publicUrl(resolved: string, basePath: string): string {
  if (!resolved.startsWith("/")) return resolved;
  const { path, hash } = splitHash(resolved);
  return `${joinBasePath(basePath, path.slice(1))}${hash}`;
}

function rewriteMarkdownLinks(markdown: string, fromFile: string, basePath: string): string {
  return markdown.replace(MARKDOWN_LINK, (_match, href: string) => {
    const resolved = resolveGuideLink(href, fromFile);
    return `](${publicUrl(resolved, basePath)})`;
  });
}

function proseFromBlock(block: string): string {
  const text = block
    .split("\n")
    .filter((line) => !line.trim().startsWith("#"))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text || /^Status:\s/i.test(text)) return "";
  return text;
}

function firstProseParagraph(markdown: string): string {
  const body = markdown.replace(/^#\s+.+\n*/, "");
  for (const block of body.split(/\n\n+/)) {
    const prose = proseFromBlock(block);
    if (prose) return prose;
  }
  return "";
}

function plainDescriptionText(text: string, fromFile: string, basePath: string): string {
  const linked = rewriteMarkdownLinks(text, fromFile, basePath);
  return linked
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function guideDescription(source: GuideSource, basePath: string): string {
  const prose = firstProseParagraph(source.markdown);
  const description = prose ? plainDescriptionText(prose, source.file, basePath) : "";
  return description || source.title;
}

function indexLinkUrl(href: string, basePath: string): string {
  const path = href.replace(/^\//, "");
  if (href.startsWith("/docs/")) {
    return joinBasePath(basePath, `${path}.md`);
  }
  return joinBasePath(basePath, path);
}

export function buildGuideMarkdownCopy(source: GuideSource, basePath: string): string {
  return rewriteMarkdownLinks(source.markdown, source.file, basePath);
}

export function buildLlmsIndex(
  sections: NavSection[],
  descriptions: Map<string, string>,
  basePath: string,
): string {
  const lines = [`# ${LLMS_TITLE}`, "", `> ${LLMS_SUMMARY}`, ""];
  for (const section of sections) {
    lines.push(`## ${section.title}`, "");
    for (const link of section.links) {
      const description = descriptions.get(link.href) ?? link.title;
      lines.push(`- [${link.title}](${indexLinkUrl(link.href, basePath)}): ${description}`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

export function buildLlmsFull(sources: GuideSource[], basePath: string): string {
  return sources.map((source) => buildGuideMarkdownCopy(source, basePath)).join("\n\n");
}

export async function pageDescriptions(basePath: string): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const source of listPublishedSources()) {
    map.set(source.href, guideDescription(source, basePath));
  }
  const catalog = await loadRegistryCatalog();
  for (const item of catalog.items) {
    const href = itemHref(item);
    map.set(href, item.description ?? itemTitle(item));
  }
  const modules = await loadModules();
  for (const { manifest } of modules) {
    map.set(modulePath(manifest.category, manifest.id), manifest.description);
  }
  return map;
}

function writeTextFile(filePath: string, contents: string): void {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, contents, "utf8");
}

/** Writes llms artifacts at the root of the static client output (after base-path hoist). */
export async function writeLlmsArtifacts(clientDir: string, basePath: string): Promise<void> {
  const sections = await listNav();
  const descriptions = await pageDescriptions(basePath);
  const sources = listPublishedSources();

  writeTextFile(joinPath(clientDir, "llms.txt"), buildLlmsIndex(sections, descriptions, basePath));
  writeTextFile(joinPath(clientDir, "llms-full.txt"), buildLlmsFull(sources, basePath));

  for (const source of sources) {
    const relative = `${source.href.replace(/^\//, "")}.md`;
    writeTextFile(joinPath(clientDir, relative), buildGuideMarkdownCopy(source, basePath));
  }
}
