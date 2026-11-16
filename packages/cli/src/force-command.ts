/** A word of a shell command, quoted when the shell would split or expand it. */
function shellWord(word: string): string {
  return /^[\w@%+=:,./-]+$/.test(word) ? word : `'${word.replaceAll("'", `'\\''`)}'`;
}

/**
 * The `bg add` that does what `typed` (the arguments after `add`) did and also names `names`, with
 * `--force`. `--force` reaches the modules and items a call names and no others, so a module the call
 * plans again on its own (050 step 7) is overwritten only by a call that names it.
 */
export function addNamingCommand(typed: string[], names: string[]): string {
  return ["bg", "add", ...typed.filter((arg) => arg !== "--force"), ...names, "--force"]
    .map(shellWord)
    .join(" ");
}
