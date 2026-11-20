import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { RegistryCatalog } from "@bonne-garde/registry";

function resolveRepoRoot(): string {
  const candidates = [resolve(process.cwd(), "../.."), resolve(import.meta.dirname, "../../../..")];
  for (const root of candidates) {
    if (existsSync(join(root, "registry/registry.json"))) {
      return root;
    }
  }
  throw new Error("could not locate registry/registry.json");
}

const repoRoot = resolveRepoRoot();
const registryJson = join(repoRoot, "registry/registry.json");

const catalogKey = Symbol.for("bonne-garde.docs.registryCatalog");

type CatalogGlobal = typeof globalThis & {
  [catalogKey]?: RegistryCatalog;
};

export function getRepoRoot(): string {
  return repoRoot;
}

let catalogPromise: Promise<RegistryCatalog> | undefined;

export async function getCatalog(): Promise<RegistryCatalog> {
  const global = globalThis as CatalogGlobal;
  if (global[catalogKey]) {
    return global[catalogKey];
  }
  catalogPromise ??= (async () => {
    const { loadLocalRegistry } = await import("@bonne-garde/registry");
    const catalog = await loadLocalRegistry(registryJson);
    global[catalogKey] = catalog;
    return catalog;
  })();
  return catalogPromise;
}
