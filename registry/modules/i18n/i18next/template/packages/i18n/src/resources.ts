import type { Resource } from "i18next";

const LOCALE_FILE = /(?:^|[\\/])locales[\\/]([^\\/]+)[\\/]([^\\/]+)\.json$/;

/**
 * The i18next resources of a glob of locale files: an app writes
 * `toResources(import.meta.glob("./locales/*\/*.json", { eager: true, import: "default" }))`, its files
 * being `locales/<language>/<namespace>.json`. Anything else in the record is left out.
 */
export function toResources(modules: Record<string, unknown>): Resource {
  const resources: Resource = {};
  for (const [path, content] of Object.entries(modules)) {
    const [, language, namespace] = LOCALE_FILE.exec(path) ?? [];
    if (language === undefined || namespace === undefined) {
      continue;
    }
    if (typeof content !== "object" || content === null || Array.isArray(content)) {
      continue;
    }
    resources[language] = { ...resources[language], [namespace]: content };
  }
  return resources;
}
