import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseModuleManifest, type ModuleManifest } from "@bonne-garde/schema";
import type { RegistryModule } from "./types";

async function subdirectories(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

/**
 * One `module.json` read from `modules/<category>/<id>/`. The path is the identity (spec 035): a
 * file whose category or id disagrees with the directory it sits in is refused, since
 * `bg add <category>/<id>` and the owner string in `bg.json` are both read off the path.
 */
export function parseModuleFile(raw: string, category: string, id: string): ModuleManifest {
  const where = `modules/${category}/${id}/module.json`;
  let manifest: ModuleManifest;
  try {
    manifest = parseModuleManifest(JSON.parse(raw) as unknown);
  } catch (error) {
    throw new Error(`${where}: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (manifest.category !== category || manifest.id !== id) {
    throw new Error(
      `${where} declares ${manifest.category}/${manifest.id}: its path says ${category}/${id}`,
    );
  }
  return manifest;
}

/** Every `modules/<category>/<id>/module.json` of a local registry, each read by `parseModuleFile`. */
export async function loadModuleCatalog(registryRoot: string): Promise<RegistryModule[]> {
  const modules: RegistryModule[] = [];
  for (const category of await subdirectories(join(registryRoot, "modules"))) {
    for (const id of await subdirectories(join(registryRoot, "modules", category))) {
      const dir = join(registryRoot, "modules", category, id);
      let raw: string;
      try {
        raw = await readFile(join(dir, "module.json"), "utf8");
      } catch (error) {
        if (
          typeof error === "object" &&
          error !== null &&
          "code" in error &&
          error.code === "ENOENT"
        ) {
          continue;
        }
        throw error;
      }
      const manifest = parseModuleFile(raw, category, id);
      modules.push({ manifest, dir });
    }
  }
  return modules;
}
