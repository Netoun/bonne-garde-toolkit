export { applyInstallPlan, ApplyError, type ApplyOptions, type ApplyResult } from "./apply-plan";
export {
  fetchGithubRegistryIndex,
  loadLocalRegistry,
  loadRegistryFromSource,
  parseRegistrySource,
} from "./load-registry";
export { readInstalledModuleManifest, type ModuleManifestLookup } from "./read-module-manifest";
export { PlanError, resolveInstallPlan, searchCatalog, type InstallPlan } from "./resolve-plan";
export { sha256Hex } from "./sha256";
export type { BgMeta, RegistryCatalog, RegistryFile, RegistryItem } from "./types";
