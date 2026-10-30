import { parseJsonRegion, readJsonPath } from "./jsonc-merge";
import { parseElysiaRegion, readElysiaRegion } from "./ts-elysia";
import { parseTsRegion, readTsRegion } from "./ts-patches";

/**
 * What `doctor` asks of a recorded region without the module's `module.json`: is it still in the
 * file. A region key names its own place (`scripts.dev` is a path in a JSON file), so this needs
 * nothing but the file's name, its text and the key; comparing it with what the module declares
 * is `inspectPatch`'s job, and needs the registry.
 */

export type RegionPresence =
  | { kind: "present" }
  | { kind: "missing" }
  /** The file cannot hold regions of this kind at all: not valid JSON, say. */
  | { kind: "invalid"; reason: string };

const isJsonFile = (file: string): boolean => file.endsWith(".json") || file.endsWith(".jsonc");
const isTsFile = (file: string): boolean => /\.(?:[cm]?ts|tsx)$/.test(file);

/** Whether `regionPresence` can read this region: `false` for a kind of region it does not know. */
export function isReadableRegion(file: string, region: string): boolean {
  return (
    (isJsonFile(file) && parseJsonRegion(region) !== null) ||
    (isTsFile(file) && (parseTsRegion(region) !== null || parseElysiaRegion(region) !== null))
  );
}

/** The region in the file's text. Only meaningful when `isReadableRegion(file, region)` holds. */
export function regionPresence(file: string, text: string, region: string): RegionPresence {
  const path = isJsonFile(file) ? parseJsonRegion(region) : null;
  const typescript = isTsFile(file) ? parseTsRegion(region) : null;
  const elysia = isTsFile(file) ? parseElysiaRegion(region) : null;
  const read =
    path !== null
      ? readJsonPath(text, path)
      : typescript !== null
        ? readTsRegion(file, text, typescript)
        : elysia !== null
          ? readElysiaRegion(file, text, elysia)
          : null;
  if (read === null) {
    return { kind: "missing" };
  }
  if (!read.ok) {
    return { kind: "invalid", reason: read.reason };
  }
  return { kind: read.present ? "present" : "missing" };
}
