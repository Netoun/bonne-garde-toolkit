/** What an insertion into a text file reads of its surroundings, so that what it writes looks like its neighbours. */

/** The line ending of the file itself. */
export function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n";
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
