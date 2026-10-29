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

export type RegistryCatalog = {
  name: string;
  homepage?: string | undefined;
  items: RegistryItem[];
  rootDir: string;
};
