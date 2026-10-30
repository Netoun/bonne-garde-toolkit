import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PendingIntention } from "@bonne-garde/registry";
import { readStagedIntentions } from "./staged";

/**
 * Spec 050 steps 11 and 14, 065 "Executor protocol": the failed patches of an `add` are staged for
 * whoever resolves them, as `NN-<slug>.md` intentions plus a `session.md` that is the entry point.
 * `.bg/` is scratch and disposable, so none of it is state: `bg.json` records the failed patch with
 * the intention's id, and `bg record` closes it. Everything here is a pure function of the pending
 * intentions, with no timestamp, so staging again writes the same bytes.
 */

const ADD_DIR = ".bg/add";

/** The intention of one failed patch, in the format of 065 (the sections `intentions lint` requires). */
export function intentionDocument(pending: PendingIntention): string {
  const [category = ""] = pending.id.split("/");
  const checks =
    pending.checks.length > 0
      ? pending.checks.map((check) => `- \`${check}\``).join("\n")
      : "- the project's own `typecheck`, `test` and `check`";
  return `---
id: ${pending.id}
kind: install
domain: ${category}
classification: migration
---

# ${pending.intent}

## Goal

${pending.intent}

## Why

\`bg add\` installed \`${pending.module}\` but could not apply its \`${pending.type}\` patch to \`${pending.file}\`: ${pending.reason}.
A module's patch edits a file the project owns, so a patch that cannot is handed to you instead of rewriting the file blindly.

## Applies When

- Any line of Observable Gaps below is true of \`${pending.file}\`.

## Do Not Apply When

- \`${pending.file}\` already does what the gaps describe in another form (another name, another place): record that with \`--skip\` and say how.
- A prior stack this wiring migrates away from is not a reason to skip.

## Observable Gaps

${pending.gaps.map((gap) => `- ${gap}`).join("\n")}

## Out of Scope

- Everything else \`${pending.module}\` installed: it is in place, and only this part could not be applied.

## Reference Paths

- \`adapt\` \`${pending.file}\` — read it first, make the smallest change that closes the gaps, keep what the project has.

## Validation

${checks}

## Record Result

- Applied → \`bg record ${pending.id}\`
- Skipped → \`bg record ${pending.id} --skip "<reason>"\`
`;
}

/** The executor entry point: the protocol of 065, then the checklist. */
export function sessionDocument(entries: { id: string; file: string }[]): string {
  return `# Pending intentions

\`bg add\` left ${entries.length} change${entries.length === 1 ? "" : "s"} to make by hand: a patch it could not apply to a file the project owns became an intention. Follow the executor protocol of spec 065:

1. Read this checklist, then each intention below in order.
2. For each one, propose apply or skip, citing what you see in the project, and wait for the human's confirmation before any edit or record.
3. One confirmed intention at a time. Read the target file first and make the smallest change that closes its Observable Gaps; never retype from memory.
4. Run the intention's Validation, then the project's \`typecheck\`, \`test\` and \`check\`.
5. \`bg record <id>\` (or \`bg record <id> --skip "<reason>"\`), and one commit per intention.
6. Stop and write \`blocked.md\` beside this file when a validation fails or a decision is not confirmed; do not record.

## Checklist

${entries.map(({ id, file }) => `- [ ] \`${file}\` — \`${id}\``).join("\n")}
`;
}

export type StagedAdd = {
  /** The entry point: `.bg/add/session.md`. */
  session: string;
  /** Where each intention of this call is staged, in the order given. */
  files: { id: string; file: string }[];
};

const NUMBERED = /^\.bg\/add\/(\d{2})-/;

/**
 * Writes each pending intention to `.bg/add/NN-<slug>.md`: the file it already has when an earlier
 * `add` staged it, else the next number after the highest in the directory, so the prefix stays an
 * execution order and nothing staged before is renamed. `session.md` lists every staged intention
 * `resolved` does not name. Returns `null`, writing nothing, when none is pending.
 */
export async function stagePendingIntentions(
  projectRoot: string,
  pending: PendingIntention[],
  resolved: ReadonlySet<string>,
): Promise<StagedAdd | null> {
  if (pending.length === 0) {
    return null;
  }
  const existing = (await readStagedIntentions(projectRoot)).staged.filter(({ file }) =>
    file.startsWith(`${ADD_DIR}/`),
  );
  const byId = new Map(existing.map(({ id, file }) => [id, file]));
  let last = Math.max(0, ...existing.map(({ file }) => Number(NUMBERED.exec(file)?.[1] ?? 0)));

  const files: StagedAdd["files"] = [];
  for (const intention of pending) {
    let file = byId.get(intention.id);
    if (file === undefined) {
      last += 1;
      if (last > 99) {
        throw new Error(
          `${ADD_DIR} already holds 99 intentions: resolve some with bg record first`,
        );
      }
      file = `${ADD_DIR}/${String(last).padStart(2, "0")}-${intention.id.split("/").at(-1)}.md`;
      byId.set(intention.id, file);
    }
    files.push({ id: intention.id, file });
  }

  await mkdir(join(projectRoot, ADD_DIR), { recursive: true });
  for (const [index, intention] of pending.entries()) {
    await writeFile(join(projectRoot, files[index]?.file ?? ""), intentionDocument(intention));
  }
  const checklist = [...byId]
    .filter(([id]) => !resolved.has(id))
    .map(([id, file]) => ({ id, file }))
    .sort((a, b) => (a.file < b.file ? -1 : 1));
  const session = `${ADD_DIR}/session.md`;
  await writeFile(join(projectRoot, session), sessionDocument(checklist));
  return { session, files };
}
