import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "./lint";

export type StagedIntention = {
  id: string;
  /** Project-relative, forward slashes: `.bg/upgrade/00-align-bun-pin.md`. */
  file: string;
};

export type StagedIntentions = {
  staged: StagedIntention[];
  /** Staged files, or directories, whose id could not be read. */
  unreadable: { file: string; reason: string }[];
};

/**
 * Where intentions wait for a human or agent (spec 065). 090 has `upgrade prepare` write numbered
 * intentions to `.bg/upgrade/`; `add` stages to `.bg/add/` (065's executor protocol). The scratch
 * root is disposable, so what is read here is never a record: `bg.json` is.
 */
const STAGING_DIRS = [".bg/add", ".bg/upgrade"] as const;

/** `NN-slug.md` is an intention (065 layout); `session.md` and `blocked.md` are not. */
const STAGED_FILE_RE = /^\d{2}-[a-z0-9]+(?:-[a-z0-9]+)*\.md$/;

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readStagedIntentions(projectRoot: string): Promise<StagedIntentions> {
  const result: StagedIntentions = { staged: [], unreadable: [] };

  for (const dir of STAGING_DIRS) {
    let names: string[];
    try {
      names = await readdir(join(projectRoot, dir));
    } catch (error) {
      if (!isMissing(error)) {
        result.unreadable.push({ file: dir, reason: reasonOf(error) });
      }
      continue;
    }

    for (const name of names.filter((n) => STAGED_FILE_RE.test(n)).sort()) {
      const file = `${dir}/${name}`;
      try {
        const frontmatter = parseFrontmatter(await readFile(join(projectRoot, file), "utf8"));
        const { id } = frontmatter;
        if (typeof id !== "string" || id.length === 0) {
          throw new Error("frontmatter has no id");
        }
        result.staged.push({ id, file });
      } catch (error) {
        result.unreadable.push({ file, reason: reasonOf(error) });
      }
    }
  }

  return result;
}
