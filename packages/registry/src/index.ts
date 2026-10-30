export { applyInstallPlan, ApplyError, type ApplyOptions, type ApplyResult } from "./apply-plan";
export {
  FETCH_CONCURRENCY,
  GITHUB_RAW_BASE,
  RegistryFileNotFoundError,
  RegistrySourceError,
  type GithubOptions,
} from "./github-source";
export {
  loadLocalRegistry,
  loadRegistryFromSource,
  parseRegistrySource,
  type SourceOptions,
} from "./load-registry";
export {
  classifyNames,
  resolveModulePlans,
  type ModulePlan,
  type ModuleRef,
  type PlannedEnvKey,
  type PlannedFile,
} from "./module-plan";
export { loadNamedModules, readPlanFiles } from "./remote-install";
export { readInstalledModuleManifest, type ModuleManifestLookup } from "./read-module-manifest";
export { PlanError, resolveInstallPlan, searchCatalog, type InstallPlan } from "./resolve-plan";
export { sha256Hex } from "./sha256";
export type {
  BgMeta,
  RegistryCatalog,
  RegistryFile,
  RegistryItem,
  RegistryModule,
  RegistryReader,
} from "./types";
