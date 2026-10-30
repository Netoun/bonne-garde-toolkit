import type { ModuleManifest } from "@bonne-garde/schema";

export type RegistryFile = {
  path: string;
  type: string;
  target?: string;
  content?: string;
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
};

/** A native module (spec 035) found under `modules/<category>/<id>/` of a local registry. */
export type RegistryModule = {
  manifest: ModuleManifest;
  /** The directory holding `module.json` and `template/`: absolute on disk, repo-relative when `reader` is set. */
  dir: string;
  /** Set when the module is read over the network; its `template/` files are fetched by name. */
  reader?: RegistryReader | undefined;
};

/**
 * How a registry that is not on this disk is read: file by file, by repo-relative path
 * (`registry/ui/button.tsx`). Absent on a local catalog, whose paths are absolute and read directly.
 */
export type RegistryReader = {
  /** `github:owner/repo@ref`, as an error names the source. */
  label: string;
  read(path: string): Promise<string>;
};

export type RegistryCatalog = {
  name: string;
  homepage?: string | undefined;
  items: RegistryItem[];
  /**
   * Every module of a local registry. Empty for a source read over the network, which has no
   * directory listing to find them by: `loadNamedModules` fetches the ones a command names.
   */
  modules: RegistryModule[];
  /** The registry's directory: absolute on disk, `registry` in a repository. */
  rootDir: string;
  reader?: RegistryReader | undefined;
};
