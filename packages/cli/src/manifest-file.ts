import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readProjectManifest,
  type ProjectManifest,
  type ProjectManifestRead,
} from "@bonne-garde/schema";

/** Reads any supported `bg.json` version as v2; the file on disk is not touched here. */
export async function loadManifest(projectRoot: string): Promise<ProjectManifestRead> {
  const raw = JSON.parse(await readFile(join(projectRoot, "bg.json"), "utf8")) as unknown;
  return readProjectManifest(raw);
}

/** The registry a project reads by default: `@bg`, else the first one declared. */
export function defaultSource(manifest: ProjectManifest): string {
  return manifest.registries["@bg"] ?? Object.values(manifest.registries)[0] ?? "";
}

/** Writes `bg.json` through a temp file and a rename, so an interrupted write never leaves half a manifest. */
export async function writeManifest(projectRoot: string, manifest: ProjectManifest): Promise<void> {
  const file = join(projectRoot, "bg.json");
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  await rename(temp, file);
}
