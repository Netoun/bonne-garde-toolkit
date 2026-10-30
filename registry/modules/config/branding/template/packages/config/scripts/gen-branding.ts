#!/usr/bin/env bun
/**
 * Reads packages/config/branding.json and writes packages/config/src/branding.generated.ts
 *
 * Usage:
 *   bun run gen:branding
 *   bun packages/config/scripts/gen-branding.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { assertBranding, renderBrandingModule, type Branding } from "../src/gen-branding";

const PACKAGE_DIR = resolve(import.meta.dir, "..");
const BRANDING_JSON = join(PACKAGE_DIR, "branding.json");
const OUTPUT = join(PACKAGE_DIR, "src/branding.generated.ts");

export function writeBrandingGenerated(branding: Branding, outputPath: string = OUTPUT): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderBrandingModule(branding));
}

function main(): void {
  if (!existsSync(BRANDING_JSON)) {
    throw new Error(`Missing ${BRANDING_JSON}`);
  }
  const raw = JSON.parse(readFileSync(BRANDING_JSON, "utf8"));
  const branding = assertBranding(raw);
  writeBrandingGenerated(branding);
  console.log(`Wrote ${OUTPUT}`);
}

if (import.meta.main) {
  main();
}
