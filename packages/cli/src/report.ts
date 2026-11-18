import { type AddOutcome } from "./add";
import { checksNotice } from "./checks-notice";

/** Spec 020: a v1 `bg.json` is rewritten as v2 on the next write, and that is stated, not silent. */
export function manifestMigrationNotice(dryRun: boolean): string {
  const changes =
    '"installed" becomes "items", "capabilities" is dropped, and "files" and "regions" start empty';
  return dryRun
    ? `bg: bg.json is version 1; a real run will rewrite it as version 2 (${changes}). Not written: --dry-run.`
    : `bg: rewrote bg.json from version 1 to version 2 (${changes}). Files already in the project are user-owned until re-added.`;
}

/**
 * What an add left to the user, on stderr: `bg add`, and `bg create` for its template's add. Spec 060:
 * a failed patch never aborts the install and is never silent. It is a pending tier-3 intention
 * (050 steps 11 and 14), staged under .bg/add/ with the executor entry point.
 */
export function reportAdd(
  { modulePlans, result, migratedFrom, staged }: AddOutcome,
  dryRun: boolean,
) {
  if (migratedFrom !== null) {
    console.error(manifestMigrationNotice(dryRun));
  }
  for (const { path, from, by } of result.tookOver) {
    console.error(`bg: ${path} was owned by ${from}; ${by} now owns it`);
  }
  const failedPatches = result.patches.filter((patch) => patch.status === "failed");
  const stagedAt = new Map((staged?.files ?? []).map(({ id, file }) => [id, file]));
  for (const { type, file, module, reason, intention } of failedPatches) {
    const where = intention === undefined ? undefined : stagedAt.get(intention);
    const resolved = intention !== undefined && !result.pending.some(({ id }) => id === intention);
    console.error(
      `bg: PATCH FAILED ${type} on ${file} (${module}): ${reason}. ` +
        (intention === undefined
          ? "Make the edit by hand."
          : resolved
            ? `Its intention ${intention} is already recorded in bg.json.`
            : `It is the pending intention ${intention}, ${where === undefined ? "dry run: nothing staged" : `staged in ${where}`}.`),
    );
  }
  const pendingCount = result.pending.length + result.authored.length;
  if (staged !== null) {
    console.error(
      `bg: ${pendingCount} pending intention${pendingCount === 1 ? "" : "s"}: ` +
        `read ${staged.session} and follow it (spec 065), then bg record <id> or bg record <id> --skip "<reason>".`,
    );
  }
  const notice = checksNotice(modulePlans, pendingCount);
  if (notice !== null) {
    console.error(notice);
  }
  return { failedPatches, stagedAt };
}
