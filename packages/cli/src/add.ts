import { resolve } from "node:path";
import { createEmptyProjectManifest, type ProjectManifest } from "@bonne-garde/schema";
import {
  applyInstallPlan,
  checkModuleSet,
  classifyNames,
  loadInstalledModules,
  loadNamedModules,
  loadRegistryFromSource,
  readPlanFiles,
  reselectedModules,
  resolveInstallPlan,
  resolveModulePlans,
  searchCatalog,
  type ApplyResult,
  type GithubOptions,
} from "@bonne-garde/registry";
import { stagePendingIntentions, type StagedAdd } from "./intentions/stage-add";
import { defaultSource, loadManifest } from "./manifest-file";
import { platformPackageVersion } from "./paths";
import { installDependencies, type PackageManager } from "./package-manager";

/**
 * How a github source is read. A caller that does not say gets GitHub raw, with `GITHUB_TOKEN` when
 * it is set, or the mirror `BONNE_GARDE_GITHUB_RAW` names (the same paths as raw.githubusercontent.com);
 * one that points `baseUrl` elsewhere (a test) is trusted with the token too, or with none.
 */
function githubOptions(override: GithubOptions | undefined): GithubOptions {
  if (override) {
    return override;
  }
  const token = process.env.GITHUB_TOKEN;
  const baseUrl = process.env.BONNE_GARDE_GITHUB_RAW;
  return { ...(token ? { token } : {}), ...(baseUrl ? { baseUrl } : {}) };
}

export async function openCatalog(projectRoot: string, explicit?: string, github?: GithubOptions) {
  let source = explicit;
  let platformVersion: string | undefined;
  if (source) {
    // Best effort: `list --source` works outside a project, where a source with no ref has no tag to read.
    platformVersion = await loadManifest(projectRoot).then(
      ({ manifest }) => manifest.platform.version,
      () => undefined,
    );
  } else {
    const { manifest } = await loadManifest(projectRoot);
    source = defaultSource(manifest);
    if (!source) {
      throw new Error("no registry configured in bg.json (pass --source)");
    }
    platformVersion = manifest.platform.version;
  }
  return loadRegistryFromSource(source, projectRoot, {
    platformVersion,
    github: githubOptions(github),
  });
}

export async function listItems(projectRoot: string, source?: string, github?: GithubOptions) {
  return (await openCatalog(projectRoot, source, github)).items;
}

export async function searchItems(
  projectRoot: string,
  query: string,
  source?: string,
  github?: GithubOptions,
) {
  return searchCatalog(await openCatalog(projectRoot, source, github), query);
}

export async function viewItem(
  projectRoot: string,
  name: string,
  source?: string,
  github?: GithubOptions,
) {
  const items = await listItems(projectRoot, source, github);
  const item = items.find((i) => i.name === name);
  if (!item) {
    throw new Error(`unknown item: ${name}`);
  }
  return item;
}

export type AddOptions = {
  projectRoot?: string;
  /** Item names, module ids, or `<category>/<id>`: step 3 of `add` sorts them. */
  items: string[];
  source?: string;
  dryRun?: boolean;
  force?: boolean;
  install?: boolean;
  /** The install's own output (`inherit`), or kept for its error (`capture`, under a spinner). */
  installOutput?: "inherit" | "capture";
  /** Where a `github:` source is read from; GitHub raw unless a test says otherwise. */
  github?: GithubOptions;
  /** Wraps each step of the call, so a terminal can show it and name the one that failed. */
  phase?: AddPhaseRunner;
};

/** The steps of an add, in order. A dry run has no `install`. */
export type AddPhase = "plan" | "write" | "install";

/** What each step produces: the runner reads it to say what the step did. */
export type AddPhaseValues = {
  plan: Awaited<ReturnType<typeof planAdd>>;
  write: ApplyResult;
  install: { pm: PackageManager; missing: boolean };
};

export type AddPhaseRunner = <P extends AddPhase>(
  name: P,
  run: () => Promise<AddPhaseValues[P]>,
) => Promise<AddPhaseValues[P]>;

/** Every npm package an add brings: the items' and the modules', runtime and dev, once each. */
export function packagesOf({ plan, modulePlans }: AddPhaseValues["plan"]): string[] {
  return [
    ...new Set([
      ...plan.npmDependencies,
      ...plan.npmDevDependencies,
      ...modulePlans.flatMap(({ dependencies, devDependencies }) => [
        ...Object.keys(dependencies),
        ...Object.keys(devDependencies),
      ]),
    ]),
  ].sort();
}

/**
 * A check that throws what `bonne-garde add` would refuse of a set of names in an empty project,
 * reading no template file. The module manifests of `candidates` are fetched once, here: on a github
 * source that is one request each, and none for a later check.
 */
export async function namesChecker(
  source: string,
  cwd: string,
  candidates: readonly string[],
  github?: GithubOptions,
): Promise<(names: string[]) => void> {
  const loaded = await loadRegistryFromSource(source, cwd, {
    platformVersion: platformPackageVersion(),
    github: githubOptions(github),
  });
  const catalog = await loadNamedModules(loaded, [...candidates]);
  const empty = createEmptyProjectManifest({ scope: "@acme", registries: {} });
  return (names) => {
    const { items, modules } = classifyNames(catalog, names);
    checkModuleSet(catalog, modules, empty);
    resolveInstallPlan(catalog, items, empty, modules);
  };
}

export type AddOutcome = Awaited<ReturnType<typeof addItems>>;

/** Step one: read the registry, sort the names, plan the items and the modules. Nothing is written. */
async function planAdd(
  options: AddOptions,
  projectRoot: string,
  manifest: ProjectManifest,
  source: string,
) {
  const loaded = await loadRegistryFromSource(source, projectRoot, {
    platformVersion: manifest.platform.version,
    github: githubOptions(options.github),
  });
  // A github source has no directory to list: fetch the modules these names could mean, and the
  // files of the planned items, before anything is applied, so a 404 fails the install whole.
  const catalog = await loadNamedModules(loaded, options.items);
  const { items, modules } = classifyNames(catalog, options.items);
  const plan = await readPlanFiles(catalog, resolveInstallPlan(catalog, items, manifest, modules));
  // 050 step 7: an installed module whose variant a module added here changes is planned again with
  // them, so installing auth after email wires email as one call naming both would have. Only a call
  // that adds a module can change one, so only it asks a github source for the installed modules.
  // `force` reaches what the call names and not those: they are the project's, planned again.
  const withInstalled =
    modules.length === 0 ? catalog : await loadInstalledModules(catalog, manifest);
  const reselected = reselectedModules(withInstalled, modules, manifest);
  const modulePlans = await resolveModulePlans(
    withInstalled,
    [...modules, ...reselected.map(({ ref }) => ref)],
    manifest,
  );
  return { plan, modulePlans, items, modules, reselected };
}

export async function addItems(options: AddOptions) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const { manifest, migratedFrom } = await loadManifest(projectRoot);
  const source = options.source ?? defaultSource(manifest);
  if (!source) {
    throw new Error("no registry configured in bg.json");
  }
  const phase: AddPhaseRunner = options.phase ?? ((_, run) => run());
  const { dryRun = false, force = false } = options;
  const planned = await phase("plan", () => planAdd(options, projectRoot, manifest, source));
  const { plan, modulePlans, items, modules, reselected } = planned;
  const result = await phase("write", () =>
    applyInstallPlan({
      projectRoot,
      manifest,
      plan,
      modules: modulePlans,
      sourceLabel: source.startsWith("local:") ? "@bg" : source,
      dryRun,
      force,
      reselected,
    }),
  );

  const packages = packagesOf(planned);
  // No package manager to install with is not a failed add: the files are written, and what the add did
  // is still reported. The caller says so (`missingPackageManager`) and exits non-zero.
  const installs = !dryRun && options.install !== false && packages.length > 0;
  const installed = installs
    ? await phase("install", () =>
        installDependencies(projectRoot, { output: options.installOutput ?? "inherit" }),
      )
    : null;
  const installMissing = installed?.missing ? installed.pm : null;

  // 050 step 14: what the failed patches became is staged for whoever resolves it. `.bg/` is scratch,
  // outside the all-or-nothing apply, and a dry run writes nothing.
  const resolved = new Set(
    Object.values(result.manifest.modules).flatMap((records) =>
      records.flatMap(({ intentions }) => [
        ...intentions.applied,
        ...Object.keys(intentions.skipped),
      ]),
    ),
  );
  const staged: StagedAdd | null = dryRun
    ? null
    : await stagePendingIntentions(projectRoot, [...result.pending, ...result.authored], resolved);

  // Named in the call, installed before it, and left as they were: the report says so, not "added".
  const written = new Set(result.written);
  const touched = new Set([
    ...Object.entries(result.manifest.files)
      .filter(([path]) => written.has(path))
      .map(([, { owner }]) => owner),
    ...result.patches.filter(({ status }) => status === "applied").map(({ module }) => module),
  ]);
  const unchanged = [
    ...items.filter((name) => name in manifest.items),
    ...modules
      .filter(({ category, id }) => manifest.modules[category]?.some((record) => record.id === id))
      .map(({ category, id }) => `${category}/${id}`),
  ].filter((name) => !touched.has(name));

  return {
    plan,
    modulePlans,
    result,
    migratedFrom,
    staged,
    reselected,
    installMissing,
    requestedItems: items,
    unchanged,
    packages,
    installedWith: installed === null ? null : installed.pm,
  };
}
