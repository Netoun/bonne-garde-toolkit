import { readFile } from "node:fs/promises";
import { dirname, join, posix, resolve } from "node:path";
import { isRepoRelative } from "@bonne-garde/schema";
import {
  FETCH_CONCURRENCY,
  githubRegistry,
  RegistryFileNotFoundError,
  RegistrySourceError,
  resolveRef,
  STALE_TOKEN_HINT,
  type GithubOptions,
  type GithubRegistry,
} from "./github-source";
import { loadModuleCatalog } from "./module-catalog";
import { mapLimit } from "./pool";
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

/** How a registry is read: a directory on this disk, or a repository over HTTP. */
type RegistryTree = {
  join(...parts: string[]): string;
  dirname(path: string): string;
  read(path: string): Promise<string>;
};

const diskTree: RegistryTree = { join, dirname, read: (path) => readFile(path, "utf8") };

/** Paths in a repository are POSIX whatever this machine is. */
const githubTree = (registry: GithubRegistry): RegistryTree => ({
  join: posix.join,
  dirname: posix.dirname,
  read: registry.read,
});

async function loadRegistryFile(
  tree: RegistryTree,
  filePath: string,
): Promise<{
  name?: string | undefined;
  homepage?: string | undefined;
  items: RegistryItem[];
  include: string[];
}> {
  const text = await tree.read(filePath);
  let raw: unknown;
  try {
    raw = JSON.parse(text) as unknown;
  } catch (error) {
    throw new Error(
      `invalid registry at ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
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

/** The root `registry.json` and every file it `include`s, their item files made relative to `tree`'s root. */
async function loadItems(
  tree: RegistryTree,
  rootFile: string,
): Promise<{
  name: string;
  homepage?: string | undefined;
  items: RegistryItem[];
  rootDir: string;
}> {
  const rootDir = tree.dirname(rootFile);
  const root = await loadRegistryFile(tree, rootFile);
  const items: RegistryItem[] = [...root.items];
  const seen = new Set(items.map((i) => i.name));

  const included = await mapLimit(root.include, FETCH_CONCURRENCY, async (rel) => {
    const includedPath = tree.join(rootDir, rel);
    return { dir: tree.dirname(includedPath), file: await loadRegistryFile(tree, includedPath) };
  });
  for (const { dir, file } of included) {
    for (const item of file.items) {
      if (seen.has(item.name)) {
        throw new Error(`duplicate registry item name: ${item.name}`);
      }
      seen.add(item.name);
      const files = item.files?.map((f) => ({ ...f, path: tree.join(dir, f.path) }));
      items.push(files ? { ...item, files } : item);
    }
  }

  if (!root.name) {
    throw new Error("root registry.json must define name");
  }
  return { name: root.name, homepage: root.homepage, items, rootDir };
}

export async function loadLocalRegistry(registryJsonPath: string): Promise<RegistryCatalog> {
  const loaded = await loadItems(diskTree, resolve(registryJsonPath));
  return {
    name: loaded.name,
    homepage: loaded.homepage,
    items: loaded.items,
    modules: await loadModuleCatalog(loaded.rootDir),
    rootDir: loaded.rootDir,
  };
}

const GITHUB_REPO = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;

/** `owner/repo` or `owner/repo@ref`: the ref is everything after the first `@`, slashes included. */
function parseGithubRepo(rest: string, source: string): { value: string; ref?: string } {
  const at = rest.indexOf("@");
  const value = at === -1 ? rest : rest.slice(0, at);
  const ref = at === -1 ? undefined : rest.slice(at + 1);
  if (!GITHUB_REPO.test(value) || ref === "") {
    throw new Error(`invalid github registry source: ${source} (expected github:owner/repo[@ref])`);
  }
  return ref === undefined ? { value } : { value, ref };
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
    return { kind: "github", ...parseGithubRepo(source.slice("github:".length), source) };
  }
  // A path is a path before it is an `owner/repo` shorthand: `./registry` fits both patterns.
  if (source.startsWith("/") || source.startsWith(".")) {
    return { kind: "local", value: source };
  }
  if (/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:@.+)?$/.test(source)) {
    return { kind: "github", ...parseGithubRepo(source, source) };
  }
  throw new Error(`unsupported registry source: ${source}`);
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

export type SourceOptions = {
  /** `bg.json`'s `platform.version`: the tag a github source with no `@ref` is read at (spec 070). */
  platformVersion?: string | undefined;
  github?: GithubOptions | undefined;
};

/** Where a repository's registry lives; fixed by the repo layout, as `registry/` is on disk. */
const GITHUB_REGISTRY_DIR = "registry";

/** A file that `bg add` would write outside the project, or read from outside the registry. */
function assertConfined(label: string, items: RegistryItem[]): void {
  for (const item of items) {
    for (const file of item.files ?? []) {
      if (!file.path.startsWith(`${GITHUB_REGISTRY_DIR}/`) || !isRepoRelative(file.path)) {
        throw new Error(`${label}: item ${item.name} reads ${file.path}, outside the registry`);
      }
      if (file.target !== undefined && !isRepoRelative(file.target)) {
        throw new Error(
          `${label}: item ${item.name} writes ${file.target}, outside the project: refusing the registry`,
        );
      }
    }
  }
}

export async function loadRegistryFromSource(
  source: string,
  cwd: string,
  options: SourceOptions = {},
): Promise<RegistryCatalog> {
  const parsed = parseRegistrySource(source);
  if (parsed.kind === "local") {
    const registryPath = parsed.value.endsWith("registry.json")
      ? resolve(cwd, parsed.value)
      : resolve(cwd, parsed.value, "registry.json");
    return loadLocalRegistry(registryPath);
  }

  const ref = resolveRef(parsed.value, parsed.ref, options.platformVersion);
  const reader = githubRegistry(parsed.value, ref, options.github);
  const indexPath = `${GITHUB_REGISTRY_DIR}/registry.json`;
  let loaded: Awaited<ReturnType<typeof loadItems>>;
  try {
    loaded = await loadItems(githubTree(reader), indexPath);
  } catch (error) {
    if (error instanceof RegistryFileNotFoundError && error.path === indexPath) {
      throw new RegistrySourceError(
        `${reader.label} has no ${indexPath}: the repository or the ref does not exist, or that ref ships no registry (404 at ${error.url})${reader.authenticated ? `; ${STALE_TOKEN_HINT}` : ""}`,
      );
    }
    throw error;
  }
  assertConfined(reader.label, loaded.items);
  return {
    name: loaded.name,
    homepage: loaded.homepage,
    items: loaded.items,
    modules: [],
    rootDir: loaded.rootDir,
    reader,
  };
}
