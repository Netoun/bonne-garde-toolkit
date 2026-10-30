import type { ModuleManifest } from "@bonne-garde/schema";

export type RegistryFile = {
  path: string;
  type: string;
  target?: string;
  content?: string;
};

export type BgMeta = {
  provides?: string[];
  requires?: string[];
  conflicts?: string[];
  transforms?: string[];
};

export type RegistryItem = {
  name: string;
  type: string;
  title?: string;
  description?: string;
  dependencies?: string[];
  devDependencies?: string[];
  registryDependencies?: string[];
  files?: RegistryFile[];
  meta?: { bg?: BgMeta };
};

/** A native module (spec 035) found under `modules/<category>/<id>/` of a local registry. */
export type RegistryModule = {
  manifest: ModuleManifest;
  /** Absolute: the directory holding `module.json` and `template/`. */
  dir: string;
};

export type RegistryCatalog = {
  name: string;
  homepage?: string | undefined;
  items: RegistryItem[];
  /** Empty for a source that is not local: modules are read from disk, not from a fetched index. */
  modules: RegistryModule[];
  rootDir: string;
};
