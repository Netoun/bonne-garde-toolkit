import { resolve } from "node:path";
import {
  applyInstallPlan,
  classifyNames,
  loadNamedModules,
  loadRegistryFromSource,
  readPlanFiles,
  resolveInstallPlan,
  resolveModulePlans,
  searchCatalog,
  type GithubOptions,
} from "@bonne-garde/registry";
import { defaultSource, loadManifest } from "./manifest-file";

/**
 * How a github source is read. A caller that does not say gets GitHub raw, with `GITHUB_TOKEN` when
 * it is set; one that points `baseUrl` elsewhere (a test) is trusted with the token too, or with none.
 */
function githubOptions(override: GithubOptions | undefined): GithubOptions {
  if (override) {
    return override;
  }
  const token = process.env.GITHUB_TOKEN;
  return token ? { token } : {};
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
  /** Item names, module ids, or `<category>/<id>`: spec 050 step 3 sorts them. */
  items: string[];
  source?: string;
  dryRun?: boolean;
  force?: boolean;
  install?: boolean;
  /** Where a `github:` source is read from; GitHub raw unless a test says otherwise. */
  github?: GithubOptions;
};

export async function addItems(options: AddOptions) {
  const projectRoot = resolve(options.projectRoot ?? process.cwd());
  const { manifest, migratedFrom } = await loadManifest(projectRoot);
  const source = options.source ?? defaultSource(manifest);
  if (!source) {
    throw new Error("no registry configured in bg.json");
  }
  const loaded = await loadRegistryFromSource(source, projectRoot, {
    platformVersion: manifest.platform.version,
    github: githubOptions(options.github),
  });
  // A github source has no directory to list: fetch the modules these names could mean, and the
  // files of the planned items, before anything is applied, so a 404 fails the install whole.
  const catalog = await loadNamedModules(loaded, options.items);
  const { items, modules } = classifyNames(catalog, options.items);
  const plan = await readPlanFiles(catalog, resolveInstallPlan(catalog, items, manifest, modules));
  const modulePlans = await resolveModulePlans(catalog, modules, manifest);
  const { dryRun = false, force = false } = options;
  const result = await applyInstallPlan({
    projectRoot,
    manifest,
    plan,
    modules: modulePlans,
    sourceLabel: source.startsWith("local:") ? "@bg" : source,
    dryRun,
    force,
  });

  const modulesNeedInstall = modulePlans.some(
    (module) =>
      Object.keys(module.dependencies).length + Object.keys(module.devDependencies).length > 0,
  );
  if (
    !dryRun &&
    options.install !== false &&
    (plan.npmDependencies.length + plan.npmDevDependencies.length > 0 || modulesNeedInstall)
  ) {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: projectRoot,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error("bun install failed after add");
    }
  }

  return { plan, modulePlans, result, migratedFrom };
}
