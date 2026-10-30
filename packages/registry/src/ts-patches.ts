import {
  Node,
  ts,
  type ExportDeclaration,
  type ImportDeclaration,
  type SourceFile,
} from "ts-morph";
import type { RegionState } from "./region-state";
import { eolOf } from "./text-layout";
import { endWithComments, parseTypeScript } from "./ts-source";

/**
 * `ts.addImport` and `ts.addNamedExport` (spec 060). ts-morph finds the node, the edit is text put
 * at its position, so every other byte of the file stays: no printer, no `formatText`. What is
 * written is what the project's formatter writes (`tooling/vite-plus`: double quotes, semicolons,
 * trailing commas, 100 columns), so `bun run check` has nothing to say about it.
 *
 * One region per specifier: `imports[<specifier>]` / `exports[<specifier>]`, whatever the names.
 * The module declares that these names come from that specifier; a name already there counts, so
 * there is no "differs" for a patch that asks for a presence: the region is equal or absent.
 */

type Kind = "import" | "export";

const PRINT_WIDTH = 100;

export const importRegion = (specifier: string): string => `imports[${specifier}]`;
export const exportRegion = (specifier: string): string => `exports[${specifier}]`;

type Declaration = ImportDeclaration | ExportDeclaration;

/** What one declaration from the specifier gives the file. */
type Present = {
  /** The names it exposes under their own name: `a` of `{ a }` and `{ a as a }`, never of `{ a as b }`. */
  names: string[];
  /** `export * from`: every name. */
  star: boolean;
  /** The `{ ... }` it could be extended in, when it has one and is not type-only. */
  braces: { start: number; end: number; elements: string[]; node: Declaration } | null;
};

function presentIn(declaration: Declaration): Present {
  if (Node.isImportDeclaration(declaration)) {
    const named = declaration.getNamedImports();
    const bindings = declaration.getImportClause()?.getNamedBindings();
    return {
      names: named
        .filter((entry) => (entry.getAliasNode()?.getText() ?? entry.getName()) === entry.getName())
        .map((entry) => entry.getName()),
      star: false,
      braces:
        bindings !== undefined && Node.isNamedImports(bindings) && !declaration.isTypeOnly()
          ? {
              start: bindings.getStart(),
              end: bindings.getEnd(),
              elements: named.map((entry) => entry.getText()),
              node: declaration,
            }
          : null,
    };
  }
  const named = declaration.getNamedExports();
  const clause = named[0]?.getParent();
  return {
    names: named.map((entry) => entry.getAliasNode()?.getText() ?? entry.getName()),
    star: declaration.compilerNode.exportClause === undefined,
    braces:
      clause !== undefined && !declaration.isTypeOnly()
        ? {
            start: clause.getStart(),
            end: clause.getEnd(),
            elements: named.map((entry) => entry.getText()),
            node: declaration,
          }
        : null,
  };
}

function declarationsFrom(kind: Kind, source: SourceFile, specifier: string): Declaration[] {
  const all: Declaration[] =
    kind === "import" ? source.getImportDeclarations() : source.getExportDeclarations();
  return all.filter((declaration) => declaration.getModuleSpecifierValue() === specifier);
}

function hasComment(text: string): boolean {
  const scanner = ts.createScanner(
    ts.ScriptTarget.Latest,
    false,
    ts.LanguageVariant.Standard,
    text,
  );
  for (let token = scanner.scan(); token !== ts.SyntaxKind.EndOfFileToken; token = scanner.scan()) {
    if (
      token === ts.SyntaxKind.SingleLineCommentTrivia ||
      token === ts.SyntaxKind.MultiLineCommentTrivia
    ) {
      return true;
    }
  }
  return false;
}

/** `import { a, b } from "x";`, or one name per line with a trailing comma when that is over the width. */
function declarationText(kind: Kind, names: string[], specifier: string, eol: string): string {
  const tail = `} from ${JSON.stringify(specifier)};`;
  const oneLine = `${kind} { ${names.join(", ")} ${tail}`;
  return oneLine.length <= PRINT_WIDTH
    ? oneLine
    : `${kind} {${eol}${names.map((name) => `  ${name},${eol}`).join("")}${tail}`;
}

type Edit = { offset: number; length: number; content: string };
type Planned = { ok: true; state: RegionState; edit: Edit | null } | { ok: false; reason: string };

function plan(kind: Kind, file: string, text: string, specifier: string, names: string[]): Planned {
  const parsed = parseTypeScript(file, text);
  if (!parsed.ok) {
    return parsed;
  }
  const { source } = parsed;
  const declarations = declarationsFrom(kind, source, specifier).map((declaration) => ({
    declaration,
    ...presentIn(declaration),
  }));
  if (declarations.some(({ star }) => star)) {
    return { ok: true, state: { kind: "equal" }, edit: null };
  }
  const have = new Set(declarations.flatMap(({ names: present }) => present));
  const missing = names.filter((name) => !have.has(name));
  if (missing.length === 0) {
    return { ok: true, state: { kind: "equal" }, edit: null };
  }

  const eol = eolOf(text);
  const extend = declarations.find(({ braces }) => braces !== null);
  if (extend?.braces) {
    const { start, end, elements, node } = extend.braces;
    if (hasComment(text.slice(start, end))) {
      return {
        ok: false,
        reason: `a comment inside the braces of the ${kind} from ${specifier} would be lost: merge ${missing.join(", ")} by hand`,
      };
    }
    // Rewritten whole, as the formatter lays out a specifier list: one line while it fits, else one per line.
    const all = [...elements, ...missing];
    const before = text.slice(node.getStart(), start);
    const after = (text.slice(end, node.getEnd()).split("\n")[0] ?? "").replace(/\r$/, "");
    const lineStart = text.lastIndexOf("\n", node.getStart() - 1) + 1;
    const oneLine = `{ ${all.join(", ")} }`;
    const fits =
      node.getStart() - lineStart + before.length + oneLine.length + after.length <= PRINT_WIDTH;
    const content = fits ? oneLine : `{${eol}${all.map((name) => `  ${name},${eol}`).join("")}}`;
    return {
      ok: true,
      state: { kind: "absent" },
      edit: { offset: start, length: end - start, content },
    };
  }

  const imports = source.getImportDeclarations();
  const anchors =
    kind === "export"
      ? [...source.getExportDeclarations().filter((d) => d.hasModuleSpecifier()), ...imports]
      : imports;
  const anchor = anchors.sort((a, b) => a.getEnd() - b.getEnd()).at(-1);
  const written = declarationText(kind, missing, specifier, eol);
  if (anchor !== undefined) {
    return {
      ok: true,
      state: { kind: "absent" },
      edit: { offset: endWithComments(anchor), length: 0, content: `${eol}${written}` },
    };
  }
  // Nothing to follow: the top of the file, after a shebang, with a blank line before what was first.
  const top = text.startsWith("#!") ? text.indexOf("\n") + 1 : 0;
  const empty = text.slice(top).trim() === "";
  return {
    ok: true,
    state: { kind: "absent" },
    edit: { offset: top, length: 0, content: `${written}${eol}${empty ? "" : eol}` },
  };
}

export type TsInspection = { ok: true; state: RegionState } | { ok: false; reason: string };

function inspect(
  kind: Kind,
  file: string,
  text: string,
  specifier: string,
  names: string[],
): TsInspection {
  const planned = plan(kind, file, text, specifier, names);
  return planned.ok ? { ok: true, state: planned.state } : planned;
}

function write(kind: Kind, file: string, text: string, specifier: string, names: string[]): string {
  const planned = plan(kind, file, text, specifier, names);
  if (!planned.ok) {
    throw new Error(planned.reason);
  }
  const { edit } = planned;
  return edit === null
    ? text
    : `${text.slice(0, edit.offset)}${edit.content}${text.slice(edit.offset + edit.length)}`;
}

export const inspectImport = (file: string, text: string, specifier: string, names: string[]) =>
  inspect("import", file, text, specifier, names);
export const addImport = (file: string, text: string, specifier: string, names: string[]) =>
  write("import", file, text, specifier, names);
export const inspectNamedExport = (
  file: string,
  text: string,
  specifier: string,
  names: string[],
) => inspect("export", file, text, specifier, names);
export const addNamedExport = (file: string, text: string, specifier: string, names: string[]) =>
  write("export", file, text, specifier, names);

/** The kind of region a TS patch writes, from its key: `imports[<specifier>]` or `exports[<specifier>]`. */
export function parseTsRegion(region: string): { kind: Kind; specifier: string } | null {
  const match = /^(imports|exports)\[(.+)\]$/s.exec(region);
  const [, which, specifier] = match ?? [];
  return which === undefined || specifier === undefined
    ? null
    : { kind: which === "imports" ? "import" : "export", specifier };
}

/** Whether the file still has a declaration from the specifier, for a reader (`doctor`) that has no module.json. */
export function readTsRegion(
  file: string,
  text: string,
  region: { kind: Kind; specifier: string },
): { ok: true; present: boolean } | { ok: false; reason: string } {
  const parsed = parseTypeScript(file, text);
  return parsed.ok
    ? {
        ok: true,
        present: declarationsFrom(region.kind, parsed.source, region.specifier).length > 0,
      }
    : parsed;
}
