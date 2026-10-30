import {
  applyEdits,
  findNodeAtLocation,
  getNodeValue,
  modify,
  parseTree,
  printParseErrorCode,
  type Edit,
  type Node,
  type ParseError,
} from "jsonc-parser";

/**
 * `scripts.merge` (spec 060): adds keys to the `scripts` object of a `package.json` without
 * reformatting the file. Every edit goes through `jsonc-parser` `modify` + `applyEdits`, so comments,
 * trailing commas and the file's own layout survive; nothing here touches text with a regex.
 */

/** The region `bg.json` records for one script: `scripts.<name>`. The name is everything after the first dot. */
export const scriptRegion = (name: string): string => `scripts.${name}`;

export type ScriptState =
  | { kind: "absent" }
  | { kind: "equal" }
  /** `current` is the text of the script, or `null` when the value is not a string. */
  | { kind: "differs"; current: string | null };

export type ScriptsInspection =
  | { ok: true; states: Record<string, ScriptState> }
  | { ok: false; reason: string };

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** The syntax tree of a JSON or JSONC file, or why it has none. */
function treeOf(text: string): { ok: true; root: Node } | { ok: false; reason: string } {
  const errors: ParseError[] = [];
  const root = parseTree(text, errors, { allowTrailingComma: true });
  const [first] = errors;
  if (first !== undefined) {
    return {
      ok: false,
      reason: `not valid JSON (${printParseErrorCode(first.error)} at line ${lineOf(text, first.offset)})`,
    };
  }
  if (root === undefined || root.type !== "object") {
    return { ok: false, reason: "the root is not a JSON object" };
  }
  return { ok: true, root };
}

/** The `scripts` node, `null` when the file has none, or why it cannot hold scripts. */
function scriptsNode(root: Node): { ok: true; node: Node | null } | { ok: false; reason: string } {
  const node = findNodeAtLocation(root, ["scripts"]);
  if (node === undefined) {
    return { ok: true, node: null };
  }
  if (node.type !== "object") {
    return {
      ok: false,
      reason: `"scripts" is ${node.type === "array" ? "an array" : `a ${node.type}`}, not an object`,
    };
  }
  return { ok: true, node };
}

/** For each wanted script: absent, already what the patch declares, or something else. */
export function inspectScripts(text: string, wanted: Record<string, string>): ScriptsInspection {
  const tree = treeOf(text);
  if (!tree.ok) {
    return tree;
  }
  const scripts = scriptsNode(tree.root);
  if (!scripts.ok) {
    return scripts;
  }
  const states: Record<string, ScriptState> = {};
  for (const [name, value] of Object.entries(wanted)) {
    const node = scripts.node === null ? undefined : findNodeAtLocation(scripts.node, [name]);
    states[name] =
      node === undefined
        ? { kind: "absent" }
        : node.type === "string" && node.value === value
          ? { kind: "equal" }
          : { kind: "differs", current: node.type === "string" ? String(node.value) : null };
  }
  return { ok: true, states };
}

/** The whitespace that starts the line `offset` sits on. */
function lineIndent(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", offset - 1) + 1))?.[0] ?? "";
}

/** The indentation of `offset`'s line when `offset` is the first thing on it, else `null`: it shares the line. */
function ownLineIndent(text: string, offset: number): string | null {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(start, offset);
  return /^[ \t]*$/.test(before) ? before : null;
}

/**
 * Where `modify` inserts a new key and what goes there. `modify` can format what it inserts, but its
 * formatter normalises the whole line the edit touches, so the neighbouring member would change too.
 * An insertion therefore keeps `modify`'s offset and takes its content from the layout of the file
 * itself (its line ending, its indentation, a member per line or all on one): the bytes that change
 * are the inserted ones.
 */
function insertionAt(text: string, root: Node, name: string, value: string, at: Edit): Edit {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const unitOfFile = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  const unit = unitOfFile.startsWith("\t") ? "\t" : unitOfFile;
  const entry = `${JSON.stringify(name)}: ${JSON.stringify(value)}`;

  // The container is `scripts` when the file has one, else the root, which then gets a `scripts`.
  const scripts = findNodeAtLocation(root, ["scripts"]);
  const container = scripts ?? root;
  const wrapped = (indent: string): string =>
    scripts !== undefined ? entry : `"scripts": {${eol}${indent}${unit}${entry}${eol}${indent}}`;
  const inline = scripts !== undefined ? entry : `"scripts": { ${entry} }`;

  const last = container.children?.at(-1);
  if (last !== undefined) {
    const indent = ownLineIndent(text, last.offset);
    return {
      offset: at.offset,
      length: 0,
      content: indent === null ? `, ${inline}` : `,${eol}${indent}${wrapped(indent)}`,
    };
  }

  // An empty container: the entry goes inside its braces, on a line of its own.
  const close = lineIndent(text, container.offset);
  const inner = `${close}${unit}`;
  const between = text.slice(at.offset, container.offset + container.length - 1);
  return /^\s*$/.test(between)
    ? {
        offset: at.offset,
        length: between.length,
        content: `${eol}${inner}${wrapped(inner)}${eol}${close}`,
      }
    : { offset: at.offset, length: 0, content: `${eol}${inner}${wrapped(inner)}` };
}

function setScript(text: string, name: string, value: string): string {
  const tree = treeOf(text);
  if (!tree.ok) {
    throw new Error(tree.reason);
  }
  const edits = modify(text, ["scripts", name], value, {});
  const [edit] = edits;
  if (edit === undefined || edits.length > 1) {
    throw new Error(`jsonc-parser made ${edits.length} edits for scripts.${name}; expected one`);
  }
  // A value that is replaced moves nothing else; a key that is inserted is laid out by `insertionAt`.
  return applyEdits(text, [
    edit.length > 0 ? edit : insertionAt(text, tree.root, name, value, edit),
  ]);
}

/**
 * Writes each script, in order, leaving every other byte of the file as it was. The caller has
 * already decided which keys to write (absent ones, and differing ones under `--force`); a file that
 * is not a JSON object is the caller's `failed` outcome, and throws here.
 */
export function setScripts(text: string, scripts: Record<string, string>): string {
  return Object.entries(scripts).reduce(
    (next, [name, value]) => setScript(next, name, value),
    text,
  );
}

export type ScriptsReading =
  | { ok: true; scripts: Record<string, unknown> }
  | { ok: false; reason: string };

/** The `scripts` object of a `package.json`, for a reader (`doctor`) that compares against it. */
export function readScripts(text: string): ScriptsReading {
  const tree = treeOf(text);
  if (!tree.ok) {
    return tree;
  }
  const scripts = scriptsNode(tree.root);
  if (!scripts.ok) {
    return scripts;
  }
  const value: unknown = scripts.node === null ? {} : getNodeValue(scripts.node);
  return { ok: true, scripts: isRecord(value) ? value : {} };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
