import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { RegistryCatalog, RegistryItem } from "./types";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseItem(raw: unknown): RegistryItem {
  if (!isRecord(raw) || typeof raw.name !== "string" || typeof raw.type !== "string") {
    throw new Error("invalid registry item");
  }
  return raw as RegistryItem;
}

async function loadRegistryFile(filePath: string): Promise<{
  name?: string | undefined;
  homepage?: string | undefined;
  items: RegistryItem[];
  include: string[];
}> {
  const raw = JSON.parse(await readFile(filePath, "utf8")) as unknown;
  if (!isRecord(raw)) {
    throw new Error(`invalid registry at ${filePath}`);
  }
  const items = Array.isArray(raw.items) ? raw.items.map(parseItem) : [];
  const include = Array.isArray(raw.include)
    ? raw.include.filter((v): v is string => typeof v === "string")
    : [];
  return {
    name: typeof raw.name === "string" ? raw.name : undefined,
    homepage: typeof raw.homepage === "string" ? raw.homepage : undefined,
    items,
    include,
  };
}

export async function loadLocalRegistry(registryJsonPath: string): Promise<RegistryCatalog> {
  const rootFile = resolve(registryJsonPath);
  const rootDir = dirname(rootFile);
  const root = await loadRegistryFile(rootFile);
  const items: RegistryItem[] = [...root.items];
  const seen = new Set(items.map((i) => i.name));

  for (const rel of root.include) {
    const includedPath = join(rootDir, rel);
    const included = await loadRegistryFile(includedPath);
    const includedDir = dirname(includedPath);
    for (const item of included.items) {
      if (seen.has(item.name)) {
        throw new Error(`duplicate registry item name: ${item.name}`);
      }
      seen.add(item.name);
      const files = item.files?.map((file) => ({
        ...file,
        path: join(includedDir, file.path),
      }));
      items.push(files ? { ...item, files } : item);
    }
  }

  if (!root.name) {
    throw new Error("root registry.json must define name");
  }

  return {
    name: root.name,
    homepage: root.homepage,
    items,
    rootDir,
  };
}

export function parseRegistrySource(source: string): {
  kind: "local" | "github";
  value: string;
  ref?: string | undefined;
} {
  if (source.startsWith("local:")) {
    return { kind: "local", value: source.slice("local:".length) };
  }
  if (source.startsWith("github:")) {
    const rest = source.slice("github:".length);
    const [repo, ref] = rest.split("@");
    if (!repo) {
      throw new Error(`invalid github registry source: ${source}`);
    }
    return { kind: "github", value: repo, ref };
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:@.+)?$/.test(source)) {
    const [repo, ref] = source.split("@");
    if (!repo) {
      throw new Error(`invalid github registry source: ${source}`);
    }
    return { kind: "github", value: repo, ref };
  }
  if (source.startsWith("/") || source.startsWith(".")) {
    return { kind: "local", value: source };
  }
  throw new Error(`unsupported registry source: ${source}`);
}

export async function fetchGithubRegistryIndex(
  ownerRepo: string,
  ref = "HEAD",
): Promise<{ name: string; homepage?: string | undefined; items: RegistryItem[] }> {
  const url = `https://raw.githubusercontent.com/${ownerRepo}/${ref}/registry/registry.json`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`failed to fetch github registry ${url}: ${response.status}`);
  }
  const raw = (await response.json()) as unknown;
  if (!isRecord(raw) || typeof raw.name !== "string") {
    throw new Error(`invalid github registry payload from ${url}`);
  }
  const items = Array.isArray(raw.items) ? raw.items.map(parseItem) : [];
  return {
    name: raw.name,
    homepage: typeof raw.homepage === "string" ? raw.homepage : undefined,
    items,
  };
}

/** The directory of a `local:` registry source, or `null` for a source that needs the network. */
export function localRegistryRoot(source: string, cwd: string): string | null {
  const parsed = parseRegistrySource(source);
  if (parsed.kind !== "local") {
    return null;
  }
  return parsed.value.endsWith("registry.json")
    ? dirname(resolve(cwd, parsed.value))
    : resolve(cwd, parsed.value);
}

export async function loadRegistryFromSource(
  source: string,
  cwd: string,
): Promise<RegistryCatalog> {
  const parsed = parseRegistrySource(source);
  if (parsed.kind === "local") {
    const registryPath = parsed.value.endsWith("registry.json")
      ? resolve(cwd, parsed.value)
      : resolve(cwd, parsed.value, "registry.json");
    return loadLocalRegistry(registryPath);
  }

  const index = await fetchGithubRegistryIndex(parsed.value, parsed.ref ?? "HEAD");
  return {
    name: index.name,
    homepage: index.homepage,
    items: index.items,
    rootDir: `github:${parsed.value}`,
  };
}
