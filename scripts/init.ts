#!/usr/bin/env bun
/**
 * Initializes the project for local development:
 *   1. Interactive selection of apps/packages to keep (+ CI/docs cleanup)
 *   2. Product branding (branding.json, scope rewrite, docs) — also: bun run brand
 *   3. Copy .env.example / .dev.vars.example → .env / .dev.vars
 *   4. Generate BETTER_AUTH_SECRET if placeholder
 *   5. Local D1 migrations + seed
 *
 * Idempotent — safe to run multiple times.
 * Usage :
 *   bun run init
 *   bun scripts/init.ts --yes
 *   bun scripts/init.ts --keep=api,spa
 *   bun scripts/init.ts --dry-run
 *   bun scripts/init.ts --force
 *   bun scripts/init.ts --skip-env --skip-db --skip-brand
 */

import { existsSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { join, resolve, relative } from "node:path";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

// ─── Constants ───────────────────────────────────────────────────────────────

const ROOT = resolve(import.meta.dir, "..");
const STATE_PATH = join(ROOT, ".acme-init.json");
const LEGACY_STATE_PATH = join(ROOT, ".bonnegarde-init.json");
const ALL_APPS = ["api", "spa", "ssr", "static"] as const;
const ALL_PACKAGES = ["ui", "emails", "config"] as const;

const APP_DESCRIPTIONS: Record<string, string> = {
  api: "Elysia API (D1 + R2 + Better-auth)",
  spa: "React Router SPA — backoffice",
  ssr: "React Router SSR — application server",
  static: "React Router — site marketing",
};

const PACKAGE_DESCRIPTIONS: Record<string, string> = {
  ui: "shadcn/ui + CSS global",
  emails: "templates React-Email",
  config: "branding partagé (white-label)",
};

// ─── State ───────────────────────────────────────────────────────────────────

type PhaseStatus = "pending" | "done";

interface InitState {
  version: 1;
  keptApps: string[];
  keptPackages: string[];
  phases: {
    selection: PhaseStatus;
    branding: PhaseStatus;
    envSetup: PhaseStatus;
    dbSetup: PhaseStatus;
  };
}

function loadState(): InitState | null {
  const path = existsSync(STATE_PATH)
    ? STATE_PATH
    : existsSync(LEGACY_STATE_PATH)
      ? LEGACY_STATE_PATH
      : null;
  if (!path) return null;
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.version === 1) {
      const state = parsed as InitState;
      if (!state.phases.branding) {
        state.phases.branding = "pending";
      }
      return state;
    }
  } catch {
    warn("State file corrupted, ignoring.");
  }
  return null;
}

function saveState(state: InitState): void {
  writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + "\n");
}

// ─── CLI Flags ───────────────────────────────────────────────────────────────

interface Flags {
  yes: boolean;
  force: boolean;
  dryRun: boolean;
  skipApps: boolean;
  skipBrand: boolean;
  skipEnv: boolean;
  skipDb: boolean;
  keep: string[] | null;
  remove: string[] | null;
}

function parseFlags(): Flags {
  const args = Bun.argv.slice(2);

  const has = (f: string) => args.includes(`--${f}`);

  const keepArg = args.find((a) => a.startsWith("--keep="));
  const removeArg = args.find((a) => a.startsWith("--remove="));

  return {
    yes: has("yes"),
    force: has("force"),
    dryRun: has("dry-run"),
    skipApps: has("skip-apps"),
    skipBrand: has("skip-brand"),
    skipEnv: has("skip-env"),
    skipDb: has("skip-db"),
    keep: keepArg
      ? keepArg
          .slice("--keep=".length)
          .split(",")
          .map((s) => s.trim())
      : null,
    remove: removeArg
      ? removeArg
          .slice("--remove=".length)
          .split(",")
          .map((s) => s.trim())
      : null,
  };
}

const flags = parseFlags();

// ─── UI Helpers ──────────────────────────────────────────────────────────────

function step(msg: string) {
  console.log(`\n\u2726 ${msg}`);
}

function done(msg: string) {
  console.log(`  \u2713 ${msg}`);
}

function warn(msg: string) {
  console.log(`  \u26A0 ${msg}`);
}

function fail(msg: string) {
  console.error(`  \u2717 ${msg}`);
}

function header(title: string) {
  const bar = "\u2550".repeat(46);
  console.log(`\n\u2554${bar}\u2557`);
  const pad = Math.max(0, 44 - title.length);
  console.log(`\u2551  ${title}${" ".repeat(pad)}\u2551`);
  console.log(`\u255A${bar}\u255D`);
}

// ─── Detection ───────────────────────────────────────────────────────────────

function detectAvailable(): { apps: string[]; packages: string[] } {
  const appsDir = join(ROOT, "apps");
  const packagesDir = join(ROOT, "packages");

  return {
    apps: ALL_APPS.filter((a) => existsSync(join(appsDir, a))),
    packages: ALL_PACKAGES.filter((p) => existsSync(join(packagesDir, p))),
  };
}

// ─── Dry-run guard ───────────────────────────────────────────────────────────

function safeExec(cmd: string, cwd: string, label: string): void {
  if (flags.dryRun) {
    console.log(`  [dry-run] Would run: ${cmd} (cwd: ${relative(ROOT, cwd)})`);
    return;
  }
  try {
    execSync(cmd, { cwd, stdio: "inherit" });
  } catch {
    throw new Error(`${label} failed — setup stopped. Fix the error and run bun run init again.`);
  }
}

function keepWorkspaceDependencies(
  available: { apps: string[]; packages: string[] },
  selected: { apps: string[]; packages: string[] },
): { apps: string[]; packages: string[] } {
  const paths = [
    ".",
    ...available.apps.map((name) => `apps/${name}`),
    ...available.packages.map((name) => `packages/${name}`),
  ];
  const manifests = paths.map((path) => {
    const file = join(ROOT, path, "package.json");
    const pkg: unknown = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
    if (!pkg || typeof pkg !== "object") throw new Error(`Invalid package manifest: ${file}`);
    const name = "name" in pkg && typeof pkg.name === "string" ? pkg.name : "";
    const dependencies = [
      "dependencies" in pkg ? pkg.dependencies : undefined,
      "devDependencies" in pkg ? pkg.devDependencies : undefined,
    ].flatMap((value) => (value && typeof value === "object" ? Object.keys(value) : []));
    return { path, name, dependencies };
  });
  const kept = new Set([
    ".",
    ...selected.apps.map((name) => `apps/${name}`),
    ...selected.packages.map((name) => `packages/${name}`),
  ]);
  // Set iteration also visits newly added dependencies, including transitive ones.
  for (const path of kept) {
    const manifest = manifests.find((entry) => entry.path === path);
    for (const dependency of manifest?.dependencies ?? []) {
      const target = manifests.find((entry) => entry.name === dependency);
      if (!target || kept.has(target.path)) continue;
      const name = target.path.split("/").pop() ?? "";
      if (flags.remove?.includes(name)) {
        throw new Error(`Cannot remove ${name}: ${path} depends on ${target.path}.`);
      }
      kept.add(target.path);
      done(`Keeping dependency ${target.path} (required by ${path})`);
    }
  }
  return {
    apps: available.apps.filter((name) => kept.has(`apps/${name}`)),
    packages: available.packages.filter((name) => kept.has(`packages/${name}`)),
  };
}

// ─── Phase 1: Selection ─────────────────────────────────────────────────────

function promptSelection(available: { apps: string[]; packages: string[] }): {
  apps: string[];
  packages: string[];
} {
  const allModules: { type: "app" | "package"; name: string }[] = [
    ...available.apps.map((a) => ({ type: "app" as const, name: a })),
    ...available.packages.map((p) => ({ type: "package" as const, name: p })),
  ];

  const selected = new Set<string>(allModules.map((m) => `${m.type}:${m.name}`));

  while (true) {
    console.clear();
    console.log("\u2726 Select what to keep\n");

    let idx = 0;
    const numbered: { index: number; type: string; name: string }[] = [];

    if (available.apps.length > 0) {
      console.log("  Apps:");
      for (const app of available.apps) {
        idx++;
        const checked = selected.has(`app:${app}`) ? "x" : " ";
        console.log(
          `  [${checked}] ${idx}. ${app.padEnd(8)} \u2014 ${APP_DESCRIPTIONS[app] ?? ""}`,
        );
        numbered.push({ index: idx, type: "app", name: app });
      }
      console.log("");
    }

    if (available.packages.length > 0) {
      console.log("  Packages:");
      for (const pkg of available.packages) {
        idx++;
        const checked = selected.has(`package:${pkg}`) ? "x" : " ";
        console.log(
          `  [${checked}] ${idx}. ${pkg.padEnd(8)} \u2014 ${PACKAGE_DESCRIPTIONS[pkg] ?? ""}`,
        );
        numbered.push({ index: idx, type: "package", name: pkg });
      }
      console.log("");
    }

    console.log("  [0] Confirm    [a] Toggle all");
    console.log("");

    const input = prompt("  Type a number (or a/0) \u2192 ");
    if (input === null) {
      console.log("\n  Cancelled — exiting.\n");
      process.exit(0);
    }

    const trimmed = input.trim().toLowerCase();

    if (trimmed === "0" || trimmed === "") {
      break;
    }

    if (trimmed === "a") {
      const allSelected = numbered.every((n) => selected.has(`${n.type}:${n.name}`));
      for (const n of numbered) {
        const key = `${n.type}:${n.name}`;
        if (allSelected) {
          selected.delete(key);
        } else {
          selected.add(key);
        }
      }
      continue;
    }

    const num = parseInt(trimmed, 10);
    if (isNaN(num)) {
      console.log(`\n  Invalid: "${trimmed}" — type a number, "a", or "0".`);
      prompt("  Press Enter to continue");
      continue;
    }

    const match = numbered.find((n) => n.index === num);
    if (!match) {
      console.log(`\n  No item #${num}. Try again.`);
      prompt("  Press Enter to continue");
      continue;
    }

    const key = `${match.type}:${match.name}`;
    if (selected.has(key)) {
      selected.delete(key);
    } else {
      selected.add(key);
    }
  }

  const apps = available.apps.filter((a) => selected.has(`app:${a}`));
  const packages = available.packages.filter((p) => selected.has(`package:${p}`));

  return { apps, packages };
}

function confirmRemoval(toRemove: { apps: string[]; packages: string[] }): boolean {
  if (flags.yes) return true;
  if (flags.dryRun) return true;

  console.log("");
  console.log(
    "  Keep:     " +
      (toRemove.apps.length > 0 || toRemove.packages.length > 0 ? "as selected" : "everything"),
  );
  if (toRemove.apps.length > 0) console.log("  Remove apps:     " + toRemove.apps.join(", "));
  if (toRemove.packages.length > 0)
    console.log("  Remove packages: " + toRemove.packages.join(", "));

  const answer = prompt("\n  Proceed with removal? [y/N] \u2192 ");
  return answer?.trim().toLowerCase() === "y";
}

function removeAppDirectory(name: string): void {
  const dir = join(ROOT, "apps", name);
  if (!existsSync(dir)) {
    done(`apps/${name} already removed`);
    return;
  }
  if (flags.dryRun) {
    console.log(`  [dry-run] Would remove apps/${name}`);
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
    done(`Removed apps/${name}`);
  } catch (e) {
    fail(`Failed to remove apps/${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

function removePackageDirectory(name: string): void {
  const dir = join(ROOT, "packages", name);
  if (!existsSync(dir)) {
    done(`packages/${name} already removed`);
    return;
  }
  if (flags.dryRun) {
    console.log(`  [dry-run] Would remove packages/${name}`);
    return;
  }
  try {
    rmSync(dir, { recursive: true, force: true });
    done(`Removed packages/${name}`);
  } catch (e) {
    fail(`Failed to remove packages/${name}: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// ─── CI/CD Cleanup ───────────────────────────────────────────────────────────

function cleanupCiYml(removed: string[]): void {
  const path = join(ROOT, ".github/workflows/ci.yml");
  if (!existsSync(path)) return;

  if (removed.length === 0) return;

  let content = readFileSync(path, "utf8");
  let changed = false;

  for (const name of removed) {
    const before = content;
    content = content
      .replace(new RegExp(`\\b${name},\\s*`, "g"), "")
      .replace(new RegExp(`,\\s*\\b${name}\\b`, "g"), "")
      .replace(new RegExp(`\\b${name}\\b(?![-\\w])`, "g"), "");
    if (content !== before) changed = true;
  }

  if (changed) {
    if (flags.dryRun) {
      console.log("  [dry-run] Would update .github/workflows/ci.yml");
    } else {
      writeFileSync(path, content);
      done("Updated .github/workflows/ci.yml");
    }
  }
}

function cleanupDeployYml(removed: string[]): void {
  const path = join(ROOT, ".github/workflows/deploy.yml");
  if (!existsSync(path)) return;

  if (removed.length === 0) return;

  let content = readFileSync(path, "utf8");
  let changed = false;

  for (const name of removed) {
    const before = content;
    content = removeJobBlock(content, `deploy-${name}`);
    if (content !== before) changed = true;
  }

  content = content.replace(/\n{3,}/g, "\n\n");

  if (changed) {
    if (flags.dryRun) {
      console.log("  [dry-run] Would update .github/workflows/deploy.yml");
    } else {
      writeFileSync(path, content);
      done("Updated .github/workflows/deploy.yml");
    }
  }
}

function removeJobBlock(content: string, jobName: string): string {
  const lines = content.split("\n");
  const startIdx = lines.findIndex((l) => l.trimStart().startsWith(`${jobName}:`));
  if (startIdx === -1) return content;

  let endIdx = lines.length;
  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i] ?? "";
    if (line.trimStart().startsWith("deploy-")) {
      endIdx = i;
      break;
    }
  }

  lines.splice(startIdx, endIdx - startIdx);
  return lines.join("\n");
}

// ─── Docs Cleanup ────────────────────────────────────────────────────────────

function cleanupCommandsMd(): void {
  const scriptPath = join(ROOT, "scripts/gen-commands.ts");
  if (!existsSync(scriptPath)) {
    warn("gen-commands.ts not found — skip COMMANDS.md regeneration");
    return;
  }
  if (flags.dryRun) {
    console.log("  [dry-run] Would regenerate docs/COMMANDS.md");
    return;
  }
  try {
    execSync("bun run gen:commands", { cwd: ROOT, stdio: "inherit" });
    done("Regenerated docs/COMMANDS.md");
  } catch {
    warn("gen:commands failed — COMMANDS.md may be out of date");
  }
}

function cleanupArchitectureMd(): void {
  const scriptPath = join(ROOT, "scripts/gen-architecture.ts");
  if (!existsSync(scriptPath)) return;
  if (flags.dryRun) {
    console.log("  [dry-run] Would regenerate docs/ARCHITECTURE.md");
    return;
  }
  try {
    execSync("bun run gen:architecture", { cwd: ROOT, stdio: "inherit" });
    done("Regenerated docs/ARCHITECTURE.md");
  } catch {
    warn("gen:architecture failed — ARCHITECTURE.md may be out of date");
  }
}

function cleanupRootEnvExample(removed: string[]): void {
  const path = join(ROOT, ".env.example");
  if (!existsSync(path)) return;

  if (removed.length === 0) return;

  let content = readFileSync(path, "utf8");
  let changed = false;

  const appVarMap: Record<string, string[]> = {
    spa: ["VITE_APP_URL"],
    ssr: ["VITE_APP_URL"],
    static: ["VITE_APP_URL"],
  };

  for (const name of removed) {
    for (const varName of appVarMap[name] ?? []) {
      const re = new RegExp(`.*${varName}=.*\\n`, "g");
      const before = content;
      content = content.replace(re, "");
      if (content !== before) changed = true;
    }
  }

  if (changed) {
    if (flags.dryRun) {
      console.log("  [dry-run] Would clean root .env.example");
    } else {
      writeFileSync(path, content);
      done("Cleaned root .env.example");
    }
  }
}

// ─── Phase 2: Env setup ─────────────────────────────────────────────────────

function copyExampleIfMissing(examplePath: string, targetPath: string, label: string): void {
  if (existsSync(targetPath)) {
    done(`${label} already exists`);
    return;
  }
  if (!existsSync(examplePath)) {
    warn(`${relative(ROOT, examplePath)} not found — skipping ${label}`);
    return;
  }
  if (flags.dryRun) {
    console.log(`  [dry-run] Would create ${label}`);
    return;
  }
  copyFileSync(examplePath, targetPath);
  done(`Created ${label}`);
}

function setupAuthSecret(): void {
  const devVarsPath = join(ROOT, "apps/api/.dev.vars");
  if (!existsSync(devVarsPath)) {
    warn("apps/api/.dev.vars not found — cannot check BETTER_AUTH_SECRET");
    return;
  }

  const devVars = readFileSync(devVarsPath, "utf8");
  const secretMatch = devVars.match(/^BETTER_AUTH_SECRET=(.+)$/m);
  const currentSecret = secretMatch?.[1]?.trim();

  if (!currentSecret || currentSecret === "changeme-minimum-32-characters-long") {
    const secret = randomBytes(32).toString("hex");
    const updated = devVars.replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET=${secret}`);
    if (!flags.dryRun) writeFileSync(devVarsPath, updated);
    done("BETTER_AUTH_SECRET generated and written to .dev.vars");
  } else {
    done("BETTER_AUTH_SECRET already set");
  }

  const resendMatch = devVars.match(/^RESEND_API_KEY=(.+)$/m);
  const resendKey = resendMatch?.[1]?.trim();
  if (!resendKey || resendKey.startsWith("re_xxxxxxxx")) {
    warn("RESEND_API_KEY is a placeholder — emails will fail until you set a real key");
  }
}

function setupEnvFiles(keptApps: string[]): void {
  step("Environment variables");

  for (const app of keptApps) {
    if (app === "api") {
      copyExampleIfMissing(
        join(ROOT, "apps/api/.dev.vars.example"),
        join(ROOT, "apps/api/.dev.vars"),
        "apps/api/.dev.vars",
      );
    } else {
      copyExampleIfMissing(
        join(ROOT, `apps/${app}/.env.example`),
        join(ROOT, `apps/${app}/.env`),
        `apps/${app}/.env`,
      );
    }
  }

  copyExampleIfMissing(join(ROOT, ".env.example"), join(ROOT, ".env"), "root .env");

  if (keptApps.includes("api")) {
    setupAuthSecret();
  }
}

function getExpectedEnvFiles(keptApps: string[]): string[] {
  const files: string[] = [join(ROOT, ".env")];

  for (const app of keptApps) {
    if (app === "api") {
      files.push(join(ROOT, "apps/api/.dev.vars"));
      continue;
    }
    files.push(join(ROOT, `apps/${app}/.env`));
  }

  return files;
}

function hasMissingEnvFiles(keptApps: string[]): boolean {
  return getExpectedEnvFiles(keptApps).some((filePath) => !existsSync(filePath));
}

// ─── Phase 3: DB setup ──────────────────────────────────────────────────────

function setupDatabase(): void {
  step("Database migrations");
  safeExec("bun run db:migrate:local", join(ROOT, "apps/api"), "Migrations");

  step("Database seed");
  safeExec("bun run db:seed", join(ROOT, "apps/api"), "Seed");

  done("Database ready");
}

// ─── Summary ─────────────────────────────────────────────────────────────────

function printSummary(keptApps: string[], keptPackages: string[]): void {
  header("Setup complete!");

  console.log("");
  console.log("  Default admin:");
  console.log("    Email:    admin@example.local");
  console.log("    Password: password123");
  console.log("");
  console.log("  Re-apply branding anytime:");
  console.log("    bun run brand");
  console.log("");

  if (keptApps.length > 0) {
    console.log("  Start dev servers:");
    console.log("    bun run dev");
    console.log("");
    console.log("  Apps:");
  }

  const portMap: Record<string, string> = {
    api: "http://localhost:5172",
    spa: "http://localhost:5173",
    ssr: "http://localhost:5174",
    static: "http://localhost:5175",
  };

  for (const app of keptApps) {
    const url = portMap[app] ?? "";
    const label = app === "api" ? "API" : app.toUpperCase();
    console.log(`    ${label.padEnd(10)} ${url}`);
  }

  if (keptPackages.length > 0) {
    console.log("");
    console.log("  Packages kept:");
    for (const pkg of keptPackages) {
      console.log(`    packages/${pkg}`);
    }
  }

  console.log("");
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main() {
  header("My App — Initialization");

  const state = flags.force ? null : loadState();
  let keptApps: string[];
  let keptPackages: string[];

  // ── Phase 1: Selection ──────────────────────────────────────────────────

  if (flags.skipApps) {
    const available = detectAvailable();
    keptApps = state?.keptApps ?? available.apps;
    keptPackages = state?.keptPackages ?? available.packages;
    warn("Skipping app selection (--skip-apps)");
  } else if (state?.phases.selection === "done" && !flags.force && !flags.keep && !flags.remove) {
    keptApps = state.keptApps;
    keptPackages = state.keptPackages;
    done("App selection already done — use --force to redo");
  } else {
    const available = detectAvailable();

    if (flags.keep && flags.remove) throw new Error("Use either --keep or --remove, not both.");
    for (const name of [...(flags.keep ?? []), ...(flags.remove ?? [])]) {
      if (![...available.apps, ...available.packages].includes(name)) {
        throw new Error(
          `Unknown module: ${name}. Available: ${[...available.apps, ...available.packages].join(", ")}`,
        );
      }
    }

    if (flags.keep) {
      keptApps = available.apps.filter((a) => flags.keep!.includes(a));
      keptPackages = available.packages.filter((p) => flags.keep!.includes(p));
    } else if (flags.remove) {
      keptApps = available.apps.filter((a) => !flags.remove!.includes(a));
      keptPackages = available.packages.filter((p) => !flags.remove!.includes(p));
    } else if (flags.yes) {
      keptApps = [...available.apps];
      keptPackages = [...available.packages];
    } else {
      const chosen = promptSelection(available);
      keptApps = chosen.apps;
      keptPackages = chosen.packages;
    }

    const selection = keepWorkspaceDependencies(available, {
      apps: keptApps,
      packages: keptPackages,
    });
    keptApps = selection.apps;
    keptPackages = selection.packages;

    const toRemoveApps = available.apps.filter((a) => !keptApps.includes(a));
    const toRemovePackages = available.packages.filter((p) => !keptPackages.includes(p));

    if (toRemoveApps.length > 0 || toRemovePackages.length > 0) {
      if (!confirmRemoval({ apps: toRemoveApps, packages: toRemovePackages })) {
        console.log("\n  Cancelled. Nothing removed.\n");
        printSummary(
          available.apps.filter((a) => existsSync(join(ROOT, "apps", a))),
          available.packages.filter((p) => existsSync(join(ROOT, "packages", p))),
        );
        return;
      }

      if (toRemoveApps.length > 0) {
        step("Removing apps");
        for (const name of toRemoveApps) {
          removeAppDirectory(name);
        }
      }

      if (toRemovePackages.length > 0) {
        step("Removing packages");
        for (const name of toRemovePackages) {
          removePackageDirectory(name);
        }
      }

      step("Cleaning up references");

      const allRemoved = [
        ...toRemoveApps.map((a) => ({ type: "app", name: a })),
        ...toRemovePackages.map((p) => ({ type: "package", name: p })),
      ];

      const removedAppNames = allRemoved.filter((r) => r.type === "app").map((r) => r.name);

      const removedAllNames = allRemoved.map((r) => r.name);

      cleanupCiYml(removedAllNames);
      cleanupDeployYml(removedAppNames);
      cleanupCommandsMd();
      cleanupArchitectureMd();
      cleanupRootEnvExample(removedAllNames);
    }
  }

  // ── Phase 1b: Branding ──────────────────────────────────────────────────

  if (flags.skipBrand) {
    warn("Skipping branding (--skip-brand)");
  } else if (state?.phases.branding === "done" && !flags.force) {
    done("Branding already done — use bun run brand or --force to redo");
  } else {
    step("Product branding");
    const brandArgs = ["bun", "scripts/brand.ts"];
    if (flags.yes) brandArgs.push("--yes");
    if (flags.dryRun) brandArgs.push("--dry-run");
    if (flags.force) brandArgs.push("--force");
    safeExec(brandArgs.join(" "), ROOT, "Brand");
  }

  // ── Phase 2: Env files ──────────────────────────────────────────────────

  if (flags.skipEnv) {
    warn("Skipping env setup (--skip-env)");
  } else if (state?.phases.envSetup !== "done" || flags.force || hasMissingEnvFiles(keptApps)) {
    setupEnvFiles(keptApps);
  } else {
    done("Env setup already done");
  }

  // ── Phase 3: Database ───────────────────────────────────────────────────

  if (flags.skipDb) {
    warn("Skipping database setup (--skip-db)");
  } else if (!keptApps.includes("api")) {
    warn("API app not kept — skipping database setup");
  } else if (state?.phases.dbSetup !== "done" || flags.force) {
    setupDatabase();
  } else {
    done("Database setup already done");
  }

  return finish(keptApps, keptPackages);
}

function finish(keptApps: string[], keptPackages: string[]) {
  if (!flags.dryRun) {
    saveState({
      version: 1,
      keptApps,
      keptPackages,
      phases: {
        selection: flags.skipApps ? (loadState()?.phases.selection ?? "done") : "done",
        branding: flags.skipBrand ? (loadState()?.phases.branding ?? "pending") : "done",
        envSetup: flags.skipEnv ? (loadState()?.phases.envSetup ?? "pending") : "done",
        dbSetup: flags.skipDb ? (loadState()?.phases.dbSetup ?? "pending") : "done",
      },
    });
  }

  printSummary(keptApps, keptPackages);
}

main();
