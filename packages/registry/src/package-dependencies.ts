import { applyEdits, findNodeAtLocation, modify, type Node } from "jsonc-parser";
import { layoutOf, treeOf } from "./json-tree";
import { jsonRegion } from "./jsonc-merge";
import { lineIndent, ownLineIndent } from "./text-layout";

/**
 * `package.dependencies` (spec 060): adds entries to the `dependencies` and `devDependencies` of a
 * `package.json`, each where the project's formatter (`sortPackageJson`) sorts it, so the file is
 * what `vp fmt` writes right after the patch and `bun run check` has nothing to say. Every edit goes
 * through `jsonc-parser`, so comments and the file's own layout survive. A region is one entry,
 * `dependencies.<name>` or `devDependencies.<name>`: the key `jsonc.merge` and `scripts.merge` would
 * claim for the same leaf, so a second module naming it conflicts whichever patch wrote it.
 */

export type DependencyMap = "dependencies" | "devDependencies";

export const DEPENDENCY_MAPS: readonly DependencyMap[] = ["dependencies", "devDependencies"];

/** One entry a patch declares. `name` has `{{SCOPE}}` rendered, `version` is exactly as written. */
export type DependencyEntry = { map: DependencyMap; name: string; version: string };

/** The entries a patch declares: `dependencies` first, then `devDependencies`, each in the order written. */
export function dependencyEntries(patch: Record<DependencyMap, Record<string, string>>) {
  return DEPENDENCY_MAPS.flatMap((map) =>
    Object.entries(patch[map]).map(([name, version]): DependencyEntry => ({ map, name, version })),
  );
}

/** The region `bg.json` records for an entry: `dependencies.<name>`, the name quoted when it has a dot in it. */
export const dependencyRegion = ({ map, name }: DependencyEntry): string => jsonRegion([map, name]);

/**
 * The order of the names in a dependency map: by UTF-16 code unit, which is what the formatter does
 * (`@a-b/c` before `@a/z`, `Zeta` before `_x` before `a`, `lodash-es` before `lodash.merge`), and
 * what the planner sorts a module's own map by. Not `localeCompare`.
 */
export const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The top-level keys `sortPackageJson` puts before `dependencies`, in vite-plus 0.2.8's oxfmt. Every
 * other key, known or not, comes after it: the formatter keeps what it does not know last. This is
 * how a map the file lacks finds its place, and `package-dependencies-format.test.ts` runs the real
 * formatter over this list, so an upgrade that moves a key fails there and not in a project.
 */
const BEFORE_DEPENDENCIES: ReadonlySet<string> = new Set([
  "$schema",
  "name",
  "displayName",
  "version",
  "stableVersion",
  "private",
  "description",
  "categories",
  "keywords",
  "homepage",
  "bugs",
  "license",
  "author",
  "maintainers",
  "contributors",
  "repository",
  "funding",
  "qna",
  "publisher",
  "man",
  "style",
  "example",
  "examplestyle",
  "assets",
  "bin",
  "source",
  "directories",
  "workspaces",
  "binary",
  "files",
  "os",
  "cpu",
  "type",
  "sideEffects",
  "main",
  "module",
  "browser",
  "types",
  "typings",
  "typesVersions",
  "react-native",
  "svelte",
  "unpkg",
  "jsdelivr",
  "jsnext:main",
  "umd:main",
  "imports",
  "exports",
  "publishConfig",
  "scripts",
  "betterScripts",
  "wireit",
]);

const keysOf = (container: Node): string[] =>
  (container.children ?? []).map((member) => String(member.children?.[0]?.value));

/** Where a map the file lacks goes among the root's keys: before the first one the formatter puts after it. */
function rootIndex(keys: string[], map: DependencyMap): number {
  const at = keys.findIndex(
    (key) =>
      !BEFORE_DEPENDENCIES.has(key) && !(map === "devDependencies" && key === "dependencies"),
  );
  return at === -1 ? keys.length : at;
}

/** Where a name goes in a map: before the first name that sorts after it, which is where a sorted map has it. */
function nameIndex(keys: string[], name: string): number {
  const at = keys.findIndex((key) => byName(key, name) > 0);
  return at === -1 ? keys.length : at;
}

/**
 * Writes one entry. A version that differs is replaced where it stands. A new name is inserted before
 * the member that sorts after it, which leaves the lines around it as they were (a trailing comment
 * stays on its line), or after the last member, where `modify` puts it and where a comma the file
 * has after the last member stays after the new one. A map the file lacks is written whole, with the
 * entry in it, at the place `rootIndex` names.
 */
function setDependency(text: string, entry: DependencyEntry): string {
  const tree = treeOf(text);
  if (!tree.ok) {
    throw new Error(tree.reason);
  }
  const { map, name, version } = entry;
  const mapNode = findNodeAtLocation(tree.root, [map]);
  if (mapNode !== undefined && mapNode.type !== "object") {
    throw new Error(`"${map}" is not an object`);
  }
  if (mapNode !== undefined && findNodeAtLocation(mapNode, [name]) !== undefined) {
    return applyEdits(text, modify(text, [map, name], version, {}));
  }

  const container = mapNode ?? tree.root;
  const keys = keysOf(container);
  const index = mapNode === undefined ? rootIndex(keys, map) : nameIndex(keys, name);
  const edits = modify(text, [map, name], version, { getInsertionIndex: () => index });
  const [at] = edits;
  if (at === undefined || edits.length > 1) {
    throw new Error(`jsonc-parser made ${edits.length} edits for ${map}.${name}; expected one`);
  }

  const { eol, unit } = layoutOf(text);
  const created = mapNode === undefined;
  const head = `${JSON.stringify(created ? map : name)}: `;
  const written = JSON.stringify(version);
  const quoted = JSON.stringify(name);
  const inline = `${head}${created ? `{ ${quoted}: ${written} }` : written}`;
  const expanded = (indent: string) =>
    `${head}${created ? `{${eol}${indent}${unit}${quoted}: ${written}${eol}${indent}}` : written}`;

  const members = container.children ?? [];
  const [first] = members;
  if (first === undefined) {
    // An empty container: the member goes inside its braces, on a line of its own.
    const close = lineIndent(text, container.offset);
    const inner = `${close}${unit}`;
    const between = text.slice(at.offset, container.offset + container.length - 1);
    return applyEdits(
      text,
      /^\s*$/.test(between)
        ? [
            {
              offset: at.offset,
              length: between.length,
              content: `${eol}${inner}${expanded(inner)}${eol}${close}`,
            },
          ]
        : [{ offset: at.offset, length: 0, content: `${eol}${inner}${expanded(inner)}` }],
    );
  }

  const next = members[index];
  if (next !== undefined) {
    const indent = ownLineIndent(text, next.offset);
    return applyEdits(text, [
      {
        offset: next.offset,
        length: 0,
        content: indent === null ? `${inline}, ` : `${expanded(indent)},${eol}${indent}`,
      },
    ]);
  }
  const last = members.at(-1) ?? first;
  const indent = ownLineIndent(text, last.offset);
  return applyEdits(text, [
    {
      offset: at.offset,
      length: 0,
      content: indent === null ? `, ${inline}` : `,${eol}${indent}${expanded(indent)}`,
    },
  ]);
}

/**
 * Writes each entry, in order, leaving every other byte of the file as it was. The caller has
 * already decided which entries to write (absent ones, and differing ones under `--force`); a file
 * that cannot hold one is the caller's `failed` outcome, and throws here. The order of the entries
 * changes nothing in the result: each lands where the formatter puts it, a map the file lacks included.
 */
export function setDependencies(text: string, entries: DependencyEntry[]): string {
  return entries.reduce((next, entry) => setDependency(next, entry), text);
}
