#!/usr/bin/env bun
/**
 * Applies product branding: writes branding.json, regenerates branding.generated.ts,
 * rewrites npm scope (@acme → @slug), and rewrites docs to product voice.
 *
 * Usage:
 *   bun run brand
 *   bun scripts/brand.ts --yes
 *   bun scripts/brand.ts --display-name="Acme Corp" --npm-scope="@acme-corp" --yes
 *   bun scripts/brand.ts --dry-run
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { branding as currentBranding } from "../packages/config/src/branding.generated";
import {
  assertBranding,
  slugFromNpmScope,
  type Branding,
} from "../packages/config/src/gen-branding";
import { writeBrandingGenerated } from "./gen-branding";

const ROOT = resolve(import.meta.dir, "..");

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".wrangler",
  ".react-router",
  "coverage",
]);

const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonc",
  ".md",
  ".mdc",
  ".txt",
  ".yml",
  ".yaml",
  ".css",
  ".html",
  ".svg",
  ".sql",
  ".toml",
  ".example",
]);

interface Flags {
  yes: boolean;
  dryRun: boolean;
  force: boolean;
  displayName: string | null;
  shortName: string | null;
  npmScope: string | null;
  publicOrigin: string | null;
  supportEmail: string | null;
  legalName: string | null;
}

function parseFlags(): Flags {
  const args = Bun.argv.slice(2);
  const has = (f: string) => args.includes(`--${f}`);
  const get = (name: string): string | null => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(`--${name}=`.length) : null;
  };
  return {
    yes: has("yes"),
    dryRun: has("dry-run"),
    force: has("force"),
    displayName: get("display-name"),
    shortName: get("short-name"),
    npmScope: get("npm-scope"),
    publicOrigin: get("public-origin"),
    supportEmail: get("support-email"),
    legalName: get("legal-name"),
  };
}

const flags = parseFlags();

function step(msg: string) {
  console.log(`\n✦ ${msg}`);
}
function done(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function warn(msg: string) {
  console.log(`  ⚠ ${msg}`);
}

function ask(label: string, fallback: string): string {
  if (flags.yes) return fallback;
  const answer = prompt(`  ${label} [${fallback}] → `);
  if (answer === null) {
    console.log("\n  Cancelled.\n");
    process.exit(0);
  }
  const trimmed = answer.trim();
  return trimmed.length > 0 ? trimmed : fallback;
}

export function collectBranding(input: Partial<Branding>, interactiveDefaults: Branding): Branding {
  const merged = {
    displayName: input.displayName ?? interactiveDefaults.displayName,
    shortName: input.shortName ?? interactiveDefaults.shortName,
    npmScope: input.npmScope ?? interactiveDefaults.npmScope,
    publicOrigin: input.publicOrigin ?? interactiveDefaults.publicOrigin,
    supportEmail: input.supportEmail ?? interactiveDefaults.supportEmail,
    legalName: input.legalName ?? interactiveDefaults.legalName,
  };
  return assertBranding(merged);
}

export function rewriteScopeInText(content: string, fromScope: string, toScope: string): string {
  if (fromScope === toScope) return content;
  return content.split(fromScope).join(toScope);
}

export function shouldScanFile(filePath: string): boolean {
  const base = filePath.split("/").pop() ?? "";
  if (base === "bun.lock" || base === "package-lock.json") return false;
  if (base.endsWith(".plan.md")) return false;
  // Keep unit-test fixtures stable across scope rewrites (@acme examples, etc.)
  if (/\.test\.(ts|tsx|js|jsx)$/.test(base)) return false;
  const dot = base.lastIndexOf(".");
  if (dot === -1) {
    return ["Dockerfile", "Makefile", "LICENSE"].includes(base);
  }
  const ext = base.slice(dot);
  return TEXT_EXT.has(ext) || base.endsWith(".env.example") || base.endsWith(".dev.vars.example");
}

function walkFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIR_NAMES.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) {
      walkFiles(full, out);
    } else if (shouldScanFile(full)) {
      out.push(full);
    }
  }
  return out;
}

export function rewriteScopeAcrossRepo(
  root: string,
  fromScope: string,
  toScope: string,
  dryRun: boolean,
): number {
  if (fromScope === toScope) return 0;
  let changed = 0;
  for (const file of walkFiles(root)) {
    const before = readFileSync(file, "utf8");
    const after = rewriteScopeInText(before, fromScope, toScope);
    if (after === before) continue;
    changed++;
    if (dryRun) {
      console.log(`  [dry-run] Would rewrite scope in ${relative(root, file)}`);
    } else {
      writeFileSync(file, after);
    }
  }
  return changed;
}

export function writeProductReadme(b: Branding): string {
  return `# ${b.displayName}

Monorepo Cloudflare : Bun + Elysia (Workers) + Drizzle (D1/SQLite) + Better-auth + React Router v8 (SPA + SSR + Static) + shadcn/ui. Toolchain: **Vite+** (Vite, Vitest, Oxlint, Oxfmt).

## Stack

| Layer | Tech |
| ----- | ---- |
| Runtime | Bun |
| API | Elysia (Cloudflare Workers) |
| Database | Drizzle + D1 (SQLite) |
| Auth | Better-auth |
| SPA | React Router v8 + shadcn/ui — Cloudflare Pages |
| SSR | React Router v8 — Cloudflare Workers |
| Static | React Router v8 (SPA by default) — Cloudflare Pages |
| Storage | Cloudflare R2 |
| Email | Resend + React-Email |

## Structure

\`\`\`
${slugFromNpmScope(b.npmScope)}/
├── apps/
│   ├── api/
│   ├── spa/
│   ├── ssr/
│   └── static/
├── packages/
│   ├── config/
│   ├── ui/
│   └── emails/
└── docs/
\`\`\`

## Getting Started

\`\`\`bash
bun install --frozen-lockfile
bun run init
bun run brand   # rejouable — identité produit + scope npm
bun run dev
\`\`\`

Use the Bun version declared in \`package.json#packageManager\`. The init wizard keeps workspace dependencies automatically; preview removals with \`bun run init -- --dry-run\`.

## Verification

\`bun run verify\` runs formatting/lint checks, typechecking (including scripts and API tests), all tests, and all builds.

\`bun run test\` includes script tests, real SQLite API tests, package tests, and frontend tests through Vite+ (Vitest + RTL + MSW).

## Default Admin — local development only

Après seed :

- Email: \`admin@example.local\`
- Password: \`password123\`

Never seed these demo credentials in production. Configure Cloudflare resources and secrets before enabling deployment; see [Environment](./docs/ENVIRONMENT.md).

## Docs

- [Architecture](./docs/ARCHITECTURE.md)
- [Commands](./docs/COMMANDS.md)
- [Design](./docs/DESIGN.md)
- [Environment](./docs/ENVIRONMENT.md)
- [Rules](./docs/RULES.md)
- [Testing](./docs/TESTING.md)
- [Agent instructions](./AGENTS.md)
`;
}

function writeProductAgentsOverview(b: Branding): string {
  return `${b.displayName} is a Bun monorepo for Cloudflare: Elysia API (Workers) + Drizzle/D1 + Better-auth + React Router v8 (SPA / SSR / static) + shadcn/ui + R2 + Resend. Toolchain: Vite+.`;
}

function applyDocMetamorphosis(b: Branding, dryRun: boolean): void {
  const readmePath = join(ROOT, "README.md");
  const agentsPath = join(ROOT, "AGENTS.md");
  const contributingPath = join(ROOT, "CONTRIBUTING.md");

  const readme = writeProductReadme(b);
  if (dryRun) {
    console.log("  [dry-run] Would rewrite README.md / AGENTS.md overview / CONTRIBUTING.md");
  } else {
    writeFileSync(readmePath, readme);
    done("README.md → product voice");

    if (existsSync(agentsPath)) {
      let agents = readFileSync(agentsPath, "utf8");
      agents = agents.replace(
        /^(## Project overview\n\n)([^\n]+)/m,
        `$1${writeProductAgentsOverview(b)}`,
      );
      agents = agents.replace(/```\n[a-z0-9-]+\/[\s\S]*?```/, () => {
        return `\`\`\`
${slugFromNpmScope(b.npmScope)}/
├── apps/api
├── apps/spa
├── apps/ssr
├── apps/static
├── packages/config
├── packages/emails
├── packages/ui
├── docs/
└── scripts/
\`\`\``;
      });
      agents = agents.replace(/\bboilerplate\b/gi, "project");
      writeFileSync(agentsPath, agents);
      done("AGENTS.md → product voice");
    }

    writeFileSync(
      contributingPath,
      `# Contributing

Thanks for considering contributing to ${b.displayName}.

See [AGENTS.md](./AGENTS.md) for engineering conventions and [docs/RULES.md](./docs/RULES.md) for detailed rules.
`,
    );
    done("CONTRIBUTING.md → product voice");

    const appReadmes: Record<string, string> = {
      "apps/api/README.md": `# ${b.displayName} API\n\nElysia API on Cloudflare Workers.\n`,
      "apps/spa/README.md": `# ${b.displayName} Backoffice\n\nReact Router SPA.\n`,
      "apps/ssr/README.md": `# ${b.displayName} SSR\n\nReact Router SSR on Cloudflare Workers.\n`,
      "packages/ui/README.md": `# ${b.displayName} UI\n\nShared shadcn/ui components and global styles.\n`,
    };
    for (const [rel, content] of Object.entries(appReadmes)) {
      const path = join(ROOT, rel);
      if (existsSync(path)) writeFileSync(path, content);
    }
    done("App package READMEs updated");
  }
}

function updateRootPackageName(b: Branding, dryRun: boolean): void {
  const pkgPath = join(ROOT, "package.json");
  const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { name?: string };
  const next = slugFromNpmScope(b.npmScope);
  if (pkg.name === next) return;
  pkg.name = next;
  if (dryRun) {
    console.log(`  [dry-run] Would set root package name to ${next}`);
  } else {
    writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    done(`Root package name → ${next}`);
  }
}

function updateUiStoreKey(fromSlug: string, toSlug: string, dryRun: boolean): void {
  const storePath = join(ROOT, "apps/spa/src/stores/ui.store.ts");
  if (!existsSync(storePath)) return;
  const before = readFileSync(storePath, "utf8");
  const after = before.replaceAll(`${fromSlug}-ui-store`, `${toSlug}-ui-store`);
  if (after === before) return;
  if (dryRun) {
    console.log("  [dry-run] Would update ui.store persist name");
  } else {
    writeFileSync(storePath, after);
    done(`ui.store persist key → ${toSlug}-ui-store`);
  }
}

function promptBranding(): Branding {
  step("Product identity");
  const displayName = flags.displayName ?? ask("Display name", currentBranding.displayName);
  const shortName = flags.shortName ?? ask("Short name (PWA)", currentBranding.shortName);
  const npmScopeRaw =
    flags.npmScope ?? ask("npm scope (e.g. @acme-corp)", currentBranding.npmScope);
  const publicOrigin = flags.publicOrigin ?? ask("Public origin", currentBranding.publicOrigin);
  const supportEmail = flags.supportEmail ?? ask("Support email", currentBranding.supportEmail);
  const legalName =
    flags.legalName ?? ask("Legal name (© / email From)", currentBranding.legalName);

  return collectBranding(
    {
      displayName,
      shortName,
      npmScope: npmScopeRaw,
      publicOrigin,
      supportEmail,
      legalName,
    },
    currentBranding,
  );
}

function main(): void {
  console.log("\n✦ Brand — apply product identity\n");

  const next = promptBranding();
  const prevScope = currentBranding.npmScope;
  const prevSlug = slugFromNpmScope(prevScope);
  const nextSlug = slugFromNpmScope(next.npmScope);

  step("Write branding.json + generated module");
  if (flags.dryRun) {
    console.log("  [dry-run] Would write branding.json and branding.generated.ts");
  } else {
    writeFileSync(join(ROOT, "branding.json"), JSON.stringify(next, null, 2) + "\n");
    writeBrandingGenerated(next);
    done("branding.json + branding.generated.ts");
  }

  step("Rewrite npm scope");
  const scopeFiles = rewriteScopeAcrossRepo(ROOT, prevScope, next.npmScope, flags.dryRun);
  done(`${scopeFiles} file(s) touched for scope ${prevScope} → ${next.npmScope}`);

  updateRootPackageName(next, flags.dryRun);
  updateUiStoreKey(prevSlug, nextSlug, flags.dryRun);

  step("Docs metamorphosis");
  applyDocMetamorphosis(next, flags.dryRun);

  if (!flags.dryRun) {
    warn("Run: bun install && bun run gen:commands && bun run gen:architecture");
  }

  console.log(`\n  Brand applied: ${next.displayName} (${next.npmScope})\n`);
}

if (import.meta.main) {
  main();
}
