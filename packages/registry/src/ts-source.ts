import { Project, type Node, type SourceFile } from "ts-morph";

/**
 * Reads one TypeScript file for a tier-2 patch (spec 060). The file is parsed alone, in memory: no
 * tsconfig, no lib files, no module resolution, no type checker. ts-morph brings the compiler it
 * parses with, so what the project has installed (TypeScript 7 here) does not matter, and a patch
 * only ever asks where a node is: it inserts text at that position and formats nothing.
 */

let project: Project | undefined;

export type ParsedSource = { ok: true; source: SourceFile } | { ok: false; reason: string };

/** `file` picks the dialect by its extension (`.tsx` is parsed as TSX), and nothing else about it is read. */
export function parseTypeScript(file: string, text: string): ParsedSource {
  project ??= new Project({
    useInMemoryFileSystem: true,
    skipLoadingLibFiles: true,
    skipFileDependencyResolution: true,
  });
  const source = project.createSourceFile(`/${file}`, text, { overwrite: true });
  const [first] = project.getProgram().getSyntacticDiagnostics(source);
  if (first !== undefined) {
    const message = first.getMessageText();
    return {
      ok: false,
      reason: `not valid TypeScript (${typeof message === "string" ? message : message.getMessageText()} at line ${first.getLineNumber() ?? 1})`,
    };
  }
  return { ok: true, source };
}

/** Where a statement's line of text ends: after the statement and a comment that trails it on the line. */
export function endWithComments(node: Node): number {
  return Math.max(node.getEnd(), ...node.getTrailingCommentRanges().map((range) => range.getEnd()));
}
