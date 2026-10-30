import { parseTree, printParseErrorCode, type Node, type ParseError } from "jsonc-parser";

/** What `scripts.merge` and `jsonc.merge` both read a JSON or JSONC file with. */

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split("\n").length;
}

/** The syntax tree of a JSON or JSONC file (comments and trailing commas allowed), or why it has none. */
export function treeOf(text: string): { ok: true; root: Node } | { ok: false; reason: string } {
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

/** The whitespace that starts the line `offset` sits on. */
export function lineIndent(text: string, offset: number): string {
  return /^[ \t]*/.exec(text.slice(text.lastIndexOf("\n", offset - 1) + 1))?.[0] ?? "";
}

/** The indentation of `offset`'s line when `offset` is the first thing on it, else `null`: it shares the line. */
export function ownLineIndent(text: string, offset: number): string | null {
  const start = text.lastIndexOf("\n", offset - 1) + 1;
  const before = text.slice(start, offset);
  return /^[ \t]*$/.test(before) ? before : null;
}

/** The line ending and the indentation unit of the file itself, so an insertion looks like its neighbours. */
export function layoutOf(text: string): { eol: string; unit: string } {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const unitOfFile = /^([ \t]+)\S/m.exec(text)?.[1] ?? "  ";
  return { eol, unit: unitOfFile.startsWith("\t") ? "\t" : unitOfFile };
}
