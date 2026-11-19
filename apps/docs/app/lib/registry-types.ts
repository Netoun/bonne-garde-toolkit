/** Docs-only mirror of catalog JSON shapes (no import from `@bonne-garde/registry` at runtime). */

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
  meta?: Record<string, unknown>;
  files?: RegistryFile[];
};

export type RegistryModuleManifest = {
  category: string;
  id: string;
};

export type RegistryModule = {
  manifest: RegistryModuleManifest;
};

export type RegistryCatalog = {
  name: string;
  homepage?: string | undefined;
  items: RegistryItem[];
  modules: RegistryModule[];
  rootDir: string;
};
