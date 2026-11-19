import { resolve } from "node:path";
import { loadLocalRegistry, type RegistryModule } from "@bonne-garde/registry";
import { MODULE_CATEGORIES } from "@bonne-garde/schema";

/** `apps/docs` is the working directory of both `react-router build` and `vp test`. */
const REGISTRY_JSON = resolve(process.cwd(), "../../registry/registry.json");

export async function loadModules(): Promise<RegistryModule[]> {
  const registry = await loadLocalRegistry(REGISTRY_JSON);
  return [...registry.modules].sort(
    (a, b) =>
      MODULE_CATEGORIES.indexOf(a.manifest.category) -
        MODULE_CATEGORIES.indexOf(b.manifest.category) ||
      a.manifest.id.localeCompare(b.manifest.id),
  );
}
