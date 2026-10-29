#!/usr/bin/env bun
/**
 * Generates the dynamic sections of docs/ARCHITECTURE.md from workspace
 * package.json files. Static content (Communication, Module Pattern) is
 * preserved between markers.
 *
 * Usage:
 *   bun run gen:architecture       # from root
 *   bun scripts/gen-architecture.ts
 */

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUTPUT = join(ROOT, "docs/ARCHITECTURE.md");
const MARKER_START = "<!-- GEN:START -->";
const MARKER_END = "<!-- GEN:END -->";

type AppInfo = {
  name: string;
  framework: string;
  mode: string;
  platform: string;
};

type PackageInfo = {
  name: string;
  role: string;
};

// ─── Detection ───────────────────────────────────────────────────────────────

function listDirs(parent: string): string[] {
  const dir = join(ROOT, parent);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !e.name.startsWith("."))
    .map((e) => e.name)
    .sort();
}

function readPkg(appDir: string, name: string): Record<string, unknown> | null {
  const path = join(ROOT, appDir, name, "package.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8"));
}

function getDeps(pkg: Record<string, unknown>): string[] {
  const deps = (pkg.dependencies as Record<string, string>) ?? {};
  const devDeps = (pkg.devDependencies as Record<string, string>) ?? {};
  return [...Object.keys(deps), ...Object.keys(devDeps)];
}

function readRouterConfig(name: string): Record<string, unknown> | null {
  const path = join(ROOT, "apps", name, "react-router.config.ts");
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf8");
  const ssr = content.includes("ssr: true");
  return { ssr };
}

function detectApp(name: string): AppInfo | null {
  const pkg = readPkg("apps", name);
  if (!pkg) return null;
  const deps = getDeps(pkg);

  const isApi = deps.some((d) => d === "elysia");
  const isReactRouter = deps.some((d) => d === "@react-router/dev");

  if (isApi) {
    return { name, framework: "Elysia", mode: "CF Worker", platform: "Workers" };
  }

  if (isReactRouter) {
    const config = readRouterConfig(name);
    const ssr = config?.ssr ?? false;
    const dependencies = pkg.dependencies;
    const version =
      dependencies && typeof dependencies === "object" && "react-router" in dependencies
        ? String(dependencies["react-router"])
        : "";
    const major = version.match(/\d+/)?.[0] ?? "?";
    return {
      name,
      framework: `React Router v${major}`,
      mode: ssr ? "SSR" : "SPA",
      platform: ssr ? "Workers" : "Pages",
    };
  }

  return { name, framework: "?", mode: "?", platform: "?" };
}

function detectPackage(name: string): PackageInfo {
  const roles: Record<string, string> = {
    config: "Shared branding / white-label config",
    ui: "shadcn/ui + global CSS",
    emails: "React-Email templates",
  };

  return { name, role: roles[name] ?? "—" };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderApps(apps: AppInfo[]): string {
  if (apps.length === 0) return "No apps detected.\n";

  const rows = apps.map(
    (a) => `| \`apps/${a.name}\` | ${a.framework} | ${a.mode} | ${a.platform} |`,
  );

  return `| App | Framework | Mode | Platform |
|-----|-----------|------|----------|
${rows.join("\n")}`;
}

function renderPackages(packages: PackageInfo[]): string {
  if (packages.length === 0) return "No packages detected.\n";

  const rows = packages.map((p) => `| \`packages/${p.name}\` | ${p.role} |`);

  return `| Package | Role |
|---------|------|
${rows.join("\n")}`;
}

function renderOverview(apps: AppInfo[], packages: PackageInfo[]): string {
  const appCount = apps.length;
  const pkgCount = packages.length;

  const appWord = appCount === 1 ? "app" : "apps";
  const pkgWord = pkgCount === 1 ? "package" : "packages";

  return `My App is a Bun monorepo with ${appCount} ${appWord} and ${pkgCount} ${pkgWord}, deployed on Cloudflare.`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const now = new Date().toISOString().slice(0, 10);

  const apps = listDirs("apps").map(detectApp).filter(Boolean) as AppInfo[];
  const packages = listDirs("packages").map(detectPackage);

  const generated = [
    `> Auto-generated from \`package.json\` files. Regenerate: \`bun run gen:architecture\`. Last: ${now}.`,
    "",
    "## Overview",
    "",
    renderOverview(apps, packages),
    "",
    "### Apps",
    "",
    renderApps(apps),
    "",
    "### Packages",
    "",
    renderPackages(packages),
    "",
  ].join("\n");

  // Read existing file, replacing or inserting between markers
  if (existsSync(OUTPUT)) {
    const existing = readFileSync(OUTPUT, "utf8");
    const startIdx = existing.indexOf(MARKER_START);
    const endIdx = existing.indexOf(MARKER_END);

    if (startIdx !== -1 && endIdx !== -1) {
      const before = existing.slice(0, startIdx + MARKER_START.length);
      const after = existing.slice(endIdx);
      writeFileSync(OUTPUT, `${before}\n${generated}\n\n${after}`);
    } else {
      // No markers yet — prepend with markers wrapping
      writeFileSync(OUTPUT, `# Architecture\n\n${MARKER_START}\n\n${generated}\n\n${MARKER_END}\n`);
    }
  } else {
    writeFileSync(OUTPUT, `# Architecture\n\n${MARKER_START}\n\n${generated}\n\n${MARKER_END}\n`);
  }

  console.log(`✓ ${OUTPUT} generated (${apps.length} apps, ${packages.length} packages)`);
}

main();
