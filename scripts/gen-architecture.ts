#!/usr/bin/env bun
/**
 * Generates the dynamic sections of docs/ARCHITECTURE.md from the workspace
 * packages and the registry tree. Static content (Communication, Module Pattern)
 * is preserved between markers.
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

type PackageInfo = {
  name: string;
  role: string;
};

type CategoryInfo = {
  category: string;
  modules: string[];
};

type RegistryInfo = {
  categories: CategoryInfo[];
  uiItems: string[];
  featureItems: string[];
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

function detectPackage(name: string): PackageInfo {
  const roles: Record<string, string> = {
    cli: "`bonne-garde`: create, add, doctor, record",
    registry: "Load, plan and apply registry items and modules",
    schema: "`bg.json` and `module.json` validation",
  };

  return { name, role: roles[name] ?? "—" };
}

function itemNames(catalog: string): string[] {
  const path = join(ROOT, catalog);
  if (!existsSync(path)) return [];
  const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
  const items =
    typeof parsed === "object" && parsed !== null && "items" in parsed ? parsed.items : [];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item: unknown) =>
    typeof item === "object" && item !== null && "name" in item && typeof item.name === "string"
      ? [item.name]
      : [],
  );
}

function detectRegistry(): RegistryInfo {
  const categories = listDirs("registry/modules").map((category) => ({
    category,
    modules: listDirs(join("registry/modules", category)),
  }));

  return {
    categories,
    uiItems: itemNames("registry/ui/registry.json"),
    featureItems: itemNames("registry/features/registry.json"),
  };
}

// ─── Rendering ───────────────────────────────────────────────────────────────

function renderPackages(packages: PackageInfo[]): string {
  if (packages.length === 0) return "No packages detected.\n";

  const rows = packages.map((p) => `| \`packages/${p.name}\` | ${p.role} |`);

  return `| Package | Role |
|---------|------|
${rows.join("\n")}`;
}

function renderRegistry(registry: RegistryInfo): string {
  const modules = registry.categories.map(
    (c) =>
      `| \`registry/modules/${c.category}\` | ${c.modules.map((m) => `\`${m}\``).join(", ")} |`,
  );
  const items = [
    ["registry/ui", registry.uiItems],
    ["registry/features", registry.featureItems],
  ] as const;
  // A long list makes the cell unreadable: past ten, the count says it.
  const itemRows = items.map(
    ([path, names]) =>
      `| \`${path}\` | ${names.length} items${names.length > 0 && names.length <= 10 ? `: ${names.join(", ")}` : ""} |`,
  );

  return `| Path | Content |
|------|---------|
${[...modules, ...itemRows].join("\n")}`;
}

function renderOverview(packages: PackageInfo[], registry: RegistryInfo): string {
  const moduleCount = registry.categories.reduce((sum, c) => sum + c.modules.length, 0);
  const itemCount = registry.uiItems.length + registry.featureItems.length;

  return `Bonne Garde is a Bun monorepo of a CLI, the registry it installs from and the base template it copies: ${packages.length} packages, ${moduleCount} modules in ${registry.categories.length} categories, ${itemCount} items.`;
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  const now = new Date().toISOString().slice(0, 10);

  const packages = listDirs("packages").map(detectPackage);
  const registry = detectRegistry();

  const generated = [
    `> Auto-generated from \`package.json\` files and the \`registry/\` tree. Regenerate: \`bun run gen:architecture\`. Last: ${now}.`,
    "",
    "## Overview",
    "",
    renderOverview(packages, registry),
    "",
    "### Packages",
    "",
    renderPackages(packages),
    "",
    "### Registry",
    "",
    renderRegistry(registry),
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

  console.log(
    `✓ ${OUTPUT} generated (${packages.length} packages, ${registry.categories.length} module categories)`,
  );
}

main();
