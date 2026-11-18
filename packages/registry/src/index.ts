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
  checkModuleSet,
  classifyNames,
  readAuthoredIntention,
  reselectedModules,
  resolveModulePlans,
  type ModulePlan,
  type ModuleRef,
  type PlannedEnvKey,
  type PlannedFile,
  type Reselected,
} from "./module-plan";
export {
  inspectPatch,
  patchRegions,
  type PatchInspection,
  type RegionDeclaration,
  type RegionState,
} from "./patch-ops";
export {
  plannedPatches,
  type AddImportPatch,
  type AddNamedExportPatch,
  type ElysiaUsePatch,
  type JsoncMergePatch,
  type PackageDependenciesPatch,
  type PlannedPatch,
  type ScriptsMergePatch,
} from "./patch-plan";
export {
  patchIntentId,
  patchIntentText,
  type AuthoredIntention,
  type PendingIntention,
} from "./pending-intentions";
export { loadInstalledModules, loadNamedModules, readPlanFiles } from "./remote-install";
export { readInstalledModuleManifest, type ModuleManifestLookup } from "./read-module-manifest";
export {
  itemFileTarget,
  itemFileText,
  PlanError,
  resolveInstallPlan,
  searchCatalog,
  type InstallPlan,
} from "./resolve-plan";
export { isReadableRegion, regionPresence, type RegionPresence } from "./region-presence";
export { scriptRegion } from "./scripts-merge";
export { sha256Hex } from "./sha256";
export type {
  RegistryCatalog,
  RegistryFile,
  RegistryItem,
  RegistryModule,
  RegistryReader,
} from "./types";
