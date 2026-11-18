/**
 * A module's `checks` should run when nothing is pending. `add` does not run them yet, so what it
 * owes the caller is the truth about why: withheld while an intention is pending (they are the
 * Validation of each), else not run at all. `null` when no module declares a check.
 */
export function checksNotice(
  modules: { key: string; checks: string[] }[],
  pending: number,
): string | null {
  const declared = modules.filter(({ checks }) => checks.length > 0);
  if (declared.length === 0) {
    return null;
  }
  // One module a line: a reader, person or agent, finds a module's checks without parsing a sentence.
  const list = declared.map(({ key, checks }) => `  ${key}: ${checks.join("; ")}`).join("\n");
  return pending > 0
    ? `bonne-garde: checks withheld while ${pending} intention${pending === 1 ? " is" : "s are"} pending; they are the Validation of each:\n${list}`
    : `bonne-garde: checks were not run: add does not run them yet:\n${list}`;
}
