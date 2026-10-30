import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { parseModuleManifest, type ModuleCategory, type ModuleManifest } from "@bonne-garde/schema";
import { localRegistryRoot } from "./load-registry";

export type ModuleManifestLookup =
  | { found: true; manifest: ModuleManifest }
  | { found: false; reason: string };

/**
 * Reads `modules/<category>/<id>/module.json` from the project's registry, with no network: a
 * `bg.json` module record does not carry `peers`, so a caller that needs them (`doctor`) has to ask
 * the registry. Anything it cannot read comes back as `found: false` and a reason, never a throw.
 */
export async function readInstalledModuleManifest(
  source: string,
  cwd: string,
  category: ModuleCategory,
  id: string,
): Promise<ModuleManifestLookup> {
  let root: string | null;
  try {
    root = localRegistryRoot(source, cwd);
  } catch (error) {
    return { found: false, reason: error instanceof Error ? error.message : String(error) };
  }
  if (root === null) {
    return {
      found: false,
      reason: `registry source ${source} is not local, and doctor is offline`,
    };
  }
  const file = join(root, "modules", category, id, "module.json");
  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch {
    return { found: false, reason: `no module.json at ${relative(cwd, file) || file}` };
  }
  try {
    return { found: true, manifest: parseModuleManifest(JSON.parse(raw) as unknown) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { found: false, reason: `${join("modules", category, id, "module.json")}: ${message}` };
  }
}
