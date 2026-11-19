import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadLocalRegistry } from "@bonne-garde/registry";

import { getRepoRoot, setCatalogInMemory } from "./registry";

const catalogCacheFile = join(process.cwd(), "build/catalog-cache.json");

export async function warmCatalog(): Promise<void> {
  const repoRoot = getRepoRoot();
  const catalog = await loadLocalRegistry(join(repoRoot, "registry/registry.json"));
  setCatalogInMemory(catalog);
  mkdirSync(dirname(catalogCacheFile), { recursive: true });
  writeFileSync(catalogCacheFile, JSON.stringify(catalog));
}
