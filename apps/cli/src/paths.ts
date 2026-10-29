import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_PLATFORM_REMOTE } from "@bonne-garde/schema";

const HERE = dirname(fileURLToPath(import.meta.url));

function readPackageName(dir: string): string | null {
  try {
    const raw = JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as {
      name?: string;
    };
    return typeof raw.name === "string" ? raw.name : null;
  } catch {
    return null;
  }
}

/** Directory that contains this CLI package.json (apps/cli or packed tarball root). */
export function packageRoot(from = HERE): string {
  let current = from;
  for (;;) {
    const name = readPackageName(current);
    if (name === "create-bonne-garde" || name === "@bonne-garde/cli") {
      return current;
    }
    // Packed layout fallback: templates/base beside src/
    if (
      existsSync(join(current, "templates/base/package.json")) &&
      existsSync(join(current, "src/bin.ts"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return resolve(HERE, "..");
}

export function findRepoRoot(from = HERE): string | null {
  let current = from;
  for (;;) {
    if (
      existsSync(join(current, "templates/base/package.json")) &&
      existsSync(join(current, "registry/registry.json"))
    ) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

export function templateBaseDir(): string {
  const embedded = join(packageRoot(), "templates/base");
  if (existsSync(join(embedded, "package.json"))) {
    return embedded;
  }
  const repo = findRepoRoot();
  if (repo) {
    return join(repo, "templates/base");
  }
  throw new Error("templates/base not found — reinstall create-bonne-garde");
}

/** Lockstep platform version from the CLI package (no leading `v`). */
export function platformPackageVersion(from = HERE): string {
  const root = packageRoot(from);
  try {
    const raw = JSON.parse(readFileSync(join(root, "package.json"), "utf8")) as {
      version?: string;
    };
    if (typeof raw.version === "string" && raw.version.length > 0) {
      return raw.version.replace(/^v/, "");
    }
  } catch {
    // fall through
  }
  return "0.0.0";
}

/** Default registry: monorepo local path in dev, GitHub source when published. */
export function defaultRegistrySource(): string {
  const repo = findRepoRoot();
  if (repo) {
    return `local:${join(repo, "registry")}`;
  }
  return `${DEFAULT_PLATFORM_REMOTE}@v${platformPackageVersion()}`;
}

/** Producer migrations/ directory (repo root). */
export function migrationsDir(from = HERE): string | null {
  const repo = findRepoRoot(from);
  return repo ? join(repo, "migrations") : null;
}

/** @deprecated use defaultRegistrySource */
export function defaultLocalRegistrySource(repoRoot?: string): string {
  if (repoRoot) {
    return `local:${join(repoRoot, "registry")}`;
  }
  return defaultRegistrySource();
}
