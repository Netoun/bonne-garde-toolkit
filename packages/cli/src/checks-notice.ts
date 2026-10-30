/**
 * Spec 050 step 15: a module's `checks` run when nothing is pending. `add` does not run them yet, so
 * what it owes the caller is the truth about why: withheld while an intention is pending (they are
 * the Validation of each, 065), else not run at all. `null` when no module declares a check.
 */
export function checksNotice(
  modules: { key: string; checks: string[] }[],
  pending: number,
): string | null {
  const declared = modules.filter(({ checks }) => checks.length > 0);
  if (declared.length === 0) {
    return null;
  }
  const list = declared.map(({ key, checks }) => `${key}: ${checks.join("; ")}`).join(" | ");
  return pending > 0
    ? `bg: checks withheld while ${pending} intention${pending === 1 ? " is" : "s are"} pending (spec 050 step 15); they are the Validation of each: ${list}`
    : `bg: checks were not run (spec 050 step 15 is not implemented): ${list}`;
}
