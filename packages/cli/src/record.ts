import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { loadNamedModules, readAuthoredIntention, type GithubOptions } from "@bonne-garde/registry";
import {
  adaptedPaths,
  cliRunner,
  isModuleCategory,
  recordIntention,
  type IntentionOutcome,
  type ProjectManifest,
} from "@bonne-garde/schema";
import { openCatalog } from "./add";
import { readStagedIntentions } from "./intentions/staged";
import { defaultSource, loadManifest, writeManifest } from "./manifest-file";

export type RecordResult = {
  /** `"platform"`, or `<category>/<module-id>`. */
  recordedIn: string;
  /** The version `bg.json` was written as when it had to be migrated to v2, else `null`. */
  migratedFrom: 1 | null;
  /** Whether `.bg/` still held this intention. It is disposable, so `false` is not an error. */
  staged: boolean;
  /** The project files that took an `intent[<id>]` region: what an applied install intention edited. */
  marked: string[];
  /** The files it declares `adapt` that are not a file of the project, so took none. */
  notFiles: string[];
};

async function isFile(projectRoot: string, path: string): Promise<boolean> {
  try {
    return (await stat(join(projectRoot, path))).isFile();
  } catch {
    return false;
  }
}

/** The `adapt` paths of an install intention, or why no source could give them. */
type Declared = { paths: string[] } | { missing: string };

/**
 * The files an install intention edits, from what is nearest first: a failed patch is an intention
 * whose one `adapt` path is the file it failed on, and `bg.json` records both; any other is its
 * document, which `add` staged under `.bg/`; and when neither is there, the module's own document in
 * the registry the project uses, for the variant `bg.json` records. Only that last source can reach the
 * network, and only for an intention the first two do not have.
 */
async function declaredAdapt(
  projectRoot: string,
  manifest: ProjectManifest,
  id: string,
  stagedFile: string | undefined,
  github: GithubOptions | undefined,
): Promise<Declared> {
  const [category, moduleId] = id.split("/");
  const record = isModuleCategory(category)
    ? manifest.modules[category]?.find((entry) => entry.id === moduleId)
    : undefined;
  const patch = record?.patches.find((entry) => entry.intention === id);
  if (patch !== undefined) {
    return { paths: [patch.file] };
  }
  if (stagedFile !== undefined) {
    try {
      return { paths: adaptedPaths(await readFile(join(projectRoot, stagedFile), "utf8")) };
    } catch {
      // Unreadable: the registry may still have it.
    }
  }
  if (!isModuleCategory(category) || record === undefined || moduleId === undefined) {
    return { missing: "it is not the intention of an installed module" };
  }
  try {
    const catalog = await loadNamedModules(await openCatalog(projectRoot, undefined, github), [
      `${category}/${moduleId}`,
    ]);
    const authored = await readAuthoredIntention(
      catalog,
      { category, id: moduleId },
      record.variant,
      id,
      manifest.scope,
    );
    return authored === null
      ? {
          missing: `${defaultSource(manifest)} ships no intention ${id} in variant ${record.variant} of ${category}/${moduleId}`,
        }
      : { paths: adaptedPaths(authored.document) };
  } catch (error) {
    return { missing: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Record one intention's outcome in `bg.json`. The CLI cannot run the intention's
 * Validation, so recording is the caller's statement that it passed; what the CLI does check is
 * that the id is canonical and, for an install id, that its module is installed.
 *
 * An applied install intention also marks each file it declares `adapt` with an `intent[<id>]` region
 * of its module, so that file is checked by region and not read as another module's file the
 * project modified. A path that is not a file of the project takes none: a region in a file that is
 * not there would be a `doctor` error.
 *
 * An applied install intention whose `adapt` paths no source has (no failed patch of its module names it,
 * `.bg/` no longer holds its document, and the registry cannot give it: it is unreachable, or does not ship
 * the intention for the variant installed) is refused and nothing is written: recording it would leave its
 * files unmarked, and `doctor --strict` calling them user-modified for good. `--skip` edited nothing and
 * needs no paths, so it reads none.
 */
export async function recordIntentionOutcome(
  projectRoot: string,
  id: string,
  outcome: IntentionOutcome,
  github?: GithubOptions,
): Promise<RecordResult> {
  const { manifest, migratedFrom } = await loadManifest(projectRoot);
  const { staged } = await readStagedIntentions(projectRoot);
  const stagedFile = staged.find((intention) => intention.id === id)?.file;

  const declared: Declared | null =
    outcome.status === "applied"
      ? await declaredAdapt(projectRoot, manifest, id, stagedFile, github)
      : null;
  const adapted: string[] = [];
  const notFiles: string[] = [];
  for (const path of declared !== null && "paths" in declared ? declared.paths : []) {
    ((await isFile(projectRoot, path)) ? adapted : notFiles).push(path);
  }

  // After `recordIntention`, which refuses a bad id or a module that is not installed first.
  const recorded = recordIntention(
    manifest,
    id,
    outcome.status === "applied" ? { status: "applied", adapted } : outcome,
  );
  const install = recorded.recordedIn !== "platform";
  if (install && declared !== null && "missing" in declared) {
    throw new Error(
      `cannot record ${id} as applied: no failed patch of ${recorded.recordedIn} names it, .bg/ no longer holds its document, ` +
        `and the registry gave none (${declared.missing}), so the files it edited cannot be found to mark. Nothing was recorded. ` +
        `Record it again when the registry can be read; or, if it is not recorded yet, \`${cliRunner()} add ${recorded.recordedIn}\` stages it again.`,
    );
  }
  await writeManifest(projectRoot, recorded.manifest);

  return {
    recordedIn: recorded.recordedIn,
    migratedFrom,
    staged: stagedFile !== undefined,
    marked: install ? adapted : [],
    notFiles: install ? notFiles : [],
  };
}
