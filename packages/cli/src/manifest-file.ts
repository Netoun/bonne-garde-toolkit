import { readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { notAProject } from "./errors";
import {
  readProjectManifest,
  type ProjectManifest,
  type ProjectManifestRead,
} from "@bonne-garde/schema";

function isMissing(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

/** Reads any supported `bg.json` version as v2; the file on disk is not touched here. */
export async function loadManifest(projectRoot: string): Promise<ProjectManifestRead> {
  const text = await readFile(join(projectRoot, "bg.json"), "utf8").catch((error: unknown) => {
    throw isMissing(error) ? notAProject(projectRoot) : error;
  });
  return readProjectManifest(JSON.parse(text) as unknown);
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
