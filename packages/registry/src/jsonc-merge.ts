import {
  applyEdits,
  createScanner,
  findNodeAtLocation,
  getNodeValue,
  modify,
  type Edit,
  type Node,
} from "jsonc-parser";
import { layoutOf, treeOf } from "./json-tree";
import { lineIndent, ownLineIndent } from "./text-layout";
import type { RegionState } from "./region-state";

/**
 * `jsonc.merge` (spec 060): deep-merges a value into a JSON or JSONC file. Every edit goes through
 * `jsonc-parser` `modify` + `applyEdits`, so comments and the file's own layout survive; what is
 * inserted is laid out like its neighbours (see `insertionAt`) and nothing touches text with a regex.
 * One region per leaf: an object is walked, anything else (an array too) is written whole.
 */

export type JsoncLeaf = { path: string[]; value: unknown };

/** The column the project's formatter wraps at (`tooling/vite-plus` ships `printWidth: 100`). */
const PRINT_WIDTH = 100;

/** A path segment that needs no quoting in a region key. */
const BARE_SEGMENT = /^[^.[\]"\\]+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The leaves of a value: one per path that ends in anything but an object. */
export function jsoncLeaves(value: Record<string, unknown>, prefix: string[] = []): JsoncLeaf[] {
  return Object.entries(value).flatMap(([key, child]) =>
    isRecord(child)
      ? jsoncLeaves(child, [...prefix, key])
      : [{ path: [...prefix, key], value: child }],
  );
}

/**
 * The region `bg.json` records for a leaf: its path joined with dots, so `scripts.gen:branding` is
 * the same text for `scripts.merge` and `jsonc.merge`. A segment with a dot, a bracket, a quote or a
 * backslash in it, or an empty one, is written as a JSON string: `dependencies."lodash.merge"`.
 */
export function jsonRegion(path: readonly string[]): string {
  return path
    .map((segment) => (BARE_SEGMENT.test(segment) ? segment : JSON.stringify(segment)))
    .join(".");
}

/** The path a region key names, or `null` when the key is not a path (`imports[./x]`). */
export function parseJsonRegion(region: string): string[] | null {
  const path: string[] = [];
  let at = 0;
  for (;;) {
    let segment: string;
    if (region[at] === '"') {
      let end = at + 1;
      while (end < region.length && region[end] !== '"') {
        end += region[end] === "\\" ? 2 : 1;
      }
      try {
        const parsed: unknown = JSON.parse(region.slice(at, end + 1));
        if (typeof parsed !== "string") {
          return null;
        }
        segment = parsed;
      } catch {
        return null;
      }
      at = end + 1;
    } else {
      const end = region.indexOf(".", at);
      const bare = region.slice(at, end === -1 ? region.length : end);
      if (!BARE_SEGMENT.test(bare)) {
        return null;
      }
      segment = bare;
      at += bare.length;
    }
    path.push(segment);
    if (at === region.length) {
      return path;
    }
    if (region[at] !== ".") {
      return null;
    }
    at += 1;
    if (at === region.length) {
      return null;
    }
  }
}

type Located =
  | { kind: "found"; node: Node }
  | { kind: "absent"; container: Node; depth: number }
  | { kind: "blocked"; at: string[]; node: Node };

/** Where `path` ends in the tree: the node, the object it would be added to, or the parent in the way. */
function locate(root: Node, path: readonly string[]): Located {
  let node = root;
  for (const [depth, segment] of path.entries()) {
    if (node.type !== "object") {
      return { kind: "blocked", at: path.slice(0, depth), node };
    }
    const child = findNodeAtLocation(node, [segment]);
    if (child === undefined) {
      return { kind: "absent", container: node, depth };
    }
    node = child;
  }
  return { kind: "found", node };
}

function sameJson(a: unknown, b: unknown): boolean {
  if (Array.isArray(a)) {
    return Array.isArray(b) && a.length === b.length && a.every((item, i) => sameJson(item, b[i]));
  }
  if (isRecord(a)) {
    if (!isRecord(b)) {
      return false;
    }
    const keys = Object.keys(a);
    return (
      keys.length === Object.keys(b).length &&
      keys.every((key) => Object.hasOwn(b, key) && sameJson(a[key], b[key]))
    );
  }
  return a === b;
}

export type JsoncInspection =
  | { ok: true; states: Map<string, RegionState> }
  | { ok: false; reason: string };

/** For each leaf: absent, already what the patch declares, or something else. */
export function inspectJsonc(text: string, leaves: JsoncLeaf[]): JsoncInspection {
  const tree = treeOf(text);
  if (!tree.ok) {
    return tree;
  }
  const states = new Map<string, RegionState>();
  for (const { path, value } of leaves) {
    const located = locate(tree.root, path);
    if (located.kind === "blocked") {
      const what = located.node.type === "array" ? "an array" : `a ${located.node.type}`;
      return { ok: false, reason: `"${jsonRegion(located.at)}" is ${what}, not an object` };
    }
    if (located.kind === "absent") {
      states.set(jsonRegion(path), { kind: "absent" });
      continue;
    }
    const current = getNodeValue(located.node);
    const text = JSON.stringify(current);
    states.set(
      jsonRegion(path),
      sameJson(current, value)
        ? { kind: "equal" }
        : { kind: "differs", current: text, shown: text },
    );
  }
  return { ok: true, states };
}

/** Whether the file has a path, for a reader (`doctor`) that only asks if a recorded region is still there. */
export function readJsonPath(
  text: string,
  path: readonly string[],
): { ok: true; present: boolean } | { ok: false; reason: string } {
  const tree = treeOf(text);
  if (!tree.ok) {
    return tree;
  }
  return { ok: true, present: locate(tree.root, path).kind === "found" };
}

type Layout = { eol: string; unit: string; trailing: boolean };

/** Whether any object or array of the file has a comma after its last member: the style a new one copies. */
function usesTrailingCommas(text: string, node: Node): boolean {
  if (node.type === "object" || node.type === "array") {
    const last = node.children?.at(-1);
    if (last !== undefined) {
      const scanner = createScanner(text, true);
      scanner.setPosition(last.offset + last.length);
      scanner.scan();
      if (
        text.slice(
          scanner.getTokenOffset(),
          scanner.getTokenOffset() + scanner.getTokenLength(),
        ) === ","
      ) {
        return true;
      }
    }
  }
  return (node.children ?? []).some((child) => usesTrailingCommas(text, child));
}

function isContainer(value: unknown): boolean {
  return typeof value === "object" && value !== null;
}

/** A value on one line, as the formatter writes one that fits: `{ "a": 1 }`, `[1, 2]`. */
function compact(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(compact).join(", ")}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    return entries.length === 0
      ? "{}"
      : `{ ${entries.map(([key, child]) => `${JSON.stringify(key)}: ${compact(child)}`).join(", ")} }`;
  }
  return JSON.stringify(value);
}

/**
 * A value on lines of its own, laid out as the project's formatter keeps it: an object expanded,
 * an array of scalars on one line while it fits in `PRINT_WIDTH` and one element per line after,
 * an array of anything else one element per line, trailing commas where the file uses them.
 * `column` is where the first character lands, `indent` the indentation of the line it is on.
 */
function render(value: unknown, indent: string, column: number, layout: Layout): string {
  const { eol, unit, trailing } = layout;
  const inner = `${indent}${unit}`;
  const comma = trailing ? "," : "";
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "[]";
    }
    if (!value.some(isContainer)) {
      const inline = compact(value);
      if (column + inline.length + 1 <= PRINT_WIDTH) {
        return inline;
      }
    }
    const items = value.map((item) => `${inner}${render(item, inner, inner.length, layout)}`);
    return `[${eol}${items.join(`,${eol}`)}${comma}${eol}${indent}]`;
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    if (entries.length === 0) {
      return "{}";
    }
    const members = entries.map(([key, child]) => {
      const head = `${JSON.stringify(key)}: `;
      return `${inner}${head}${render(child, inner, inner.length + head.length, layout)}`;
    });
    return `{${eol}${members.join(`,${eol}`)}${comma}${eol}${indent}}`;
  }
  return JSON.stringify(value);
}

/**
 * Where `modify` puts a new member and what goes there. `modify` can format what it inserts, but
 * its formatter normalises the whole line it touches, so the neighbouring member would change too:
 * an insertion keeps `modify`'s offset and takes its content from the layout of the file itself.
 * A member goes after the last one, on a line of its own when the members are one per line and
 * on the same line when they are not; any comma already after the last member stays after the new one.
 */
function insertionAt(
  text: string,
  container: Node,
  rest: string[],
  value: unknown,
  layout: Layout,
  at: Edit,
): Edit {
  const [first = "", ...below] = rest;
  const nested = below.reduceRight<unknown>((inside, key) => ({ [key]: inside }), value);
  const head = `${JSON.stringify(first)}: `;
  const member = (indent: string) =>
    `${head}${render(nested, indent, indent.length + head.length, layout)}`;
  const { eol, unit } = layout;

  const last = container.children?.at(-1);
  if (last !== undefined) {
    const indent = ownLineIndent(text, last.offset);
    return {
      offset: at.offset,
      length: 0,
      content:
        indent === null ? `, ${head}${compact(nested)}` : `,${eol}${indent}${member(indent)}`,
    };
  }

  // An empty container: the member goes inside its braces, on a line of its own.
  const close = lineIndent(text, container.offset);
  const inner = `${close}${unit}`;
  const between = text.slice(at.offset, container.offset + container.length - 1);
  return /^\s*$/.test(between)
    ? {
        offset: at.offset,
        length: between.length,
        content: `${eol}${inner}${member(inner)}${eol}${close}`,
      }
    : { offset: at.offset, length: 0, content: `${eol}${inner}${member(inner)}` };
}

function setLeaf(text: string, { path, value }: JsoncLeaf): string {
  const tree = treeOf(text);
  if (!tree.ok) {
    throw new Error(tree.reason);
  }
  const located = locate(tree.root, path);
  if (located.kind === "blocked") {
    throw new Error(`"${jsonRegion(located.at)}" is not an object`);
  }
  const edits = modify(text, path, value, {});
  const [edit] = edits;
  if (edit === undefined || edits.length > 1) {
    throw new Error(
      `jsonc-parser made ${edits.length} edits for ${jsonRegion(path)}; expected one`,
    );
  }
  const layout: Layout = { ...layoutOf(text), trailing: usesTrailingCommas(text, tree.root) };

  if (located.kind === "found") {
    // A value that is replaced moves nothing else; only its own text is laid out.
    const start = text.lastIndexOf("\n", located.node.offset - 1) + 1;
    const content = render(
      value,
      lineIndent(text, located.node.offset),
      located.node.offset - start,
      layout,
    );
    return applyEdits(text, [{ offset: edit.offset, length: edit.length, content }]);
  }
  return applyEdits(text, [
    insertionAt(text, located.container, path.slice(located.depth), value, layout, edit),
  ]);
}

/**
 * Writes each leaf, in order, leaving every other byte of the file as it was. The caller has already
 * decided which leaves to write (absent ones, and differing ones under `--force`); a file that cannot
 * hold one is the caller's `failed` outcome, and throws here.
 */
export function setJsoncLeaves(text: string, leaves: JsoncLeaf[]): string {
  return leaves.reduce((next, leaf) => setLeaf(next, leaf), text);
}
