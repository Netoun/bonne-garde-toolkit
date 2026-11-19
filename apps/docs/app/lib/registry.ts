import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import type { RegistryCatalog } from "./registry-types";

function resolveRepoRoot(): string {
  const candidates = [resolve(process.cwd(), "../.."), resolve(import.meta.dirname, "../../../..")];
  for (const root of candidates) {
    if (existsSync(join(root, "registry/registry.json"))) {
      return `${root}/`;
    }
  }
  throw new Error("could not locate registry/registry.json");
}

const repoRoot = resolveRepoRoot();
const catalogCacheFile = join(process.cwd(), "build/catalog-cache.json");

const catalogKey = Symbol.for("bonne-garde.docs.registryCatalog");

type CatalogGlobal = typeof globalThis & {
  [catalogKey]?: RegistryCatalog;
};

export function getRepoRoot(): string {
  return repoRoot.slice(0, -1);
}

export function setCatalogInMemory(catalog: RegistryCatalog): void {
  (globalThis as CatalogGlobal)[catalogKey] = catalog;
}

function readCatalogCacheFile(): RegistryCatalog {
  return JSON.parse(readFileSync(catalogCacheFile, "utf8")) as RegistryCatalog;
}

export async function getCatalog(): Promise<RegistryCatalog> {
  const global = globalThis as CatalogGlobal;
  if (global[catalogKey]) {
    return global[catalogKey];
  }
  if (existsSync(catalogCacheFile)) {
    const catalog = readCatalogCacheFile();
    global[catalogKey] = catalog;
    return catalog;
  }
  const { loadLocalRegistry } = await import("@bonne-garde/registry");
  const catalog = (await loadLocalRegistry(
    join(repoRoot, "registry/registry.json"),
  )) as RegistryCatalog;
  global[catalogKey] = catalog;
  return catalog;
}

export function getCatalogSync(): RegistryCatalog {
  const global = globalThis as CatalogGlobal;
  if (global[catalogKey]) {
    return global[catalogKey];
  }
  if (existsSync(catalogCacheFile)) {
    const catalog = readCatalogCacheFile();
    global[catalogKey] = catalog;
    return catalog;
  }
  throw new Error("registry catalog is not loaded: warmCatalog() must run before prerender");
}

export type { RegistryCatalog } from "./registry-types";
