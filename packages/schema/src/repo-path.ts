/** Repo-relative and traversal-safe: not absolute, no `..` segment. */
export function isRepoRelative(path: string): boolean {
  if (path.length === 0 || /^([/\\]|[A-Za-z]:)/.test(path)) {
    return false;
  }
  return !path.split(/[/\\]/).includes("..");
}
