#!/usr/bin/env tsx
/**
 * Reads packages/config/branding.json and writes what is generated from it:
 * packages/config/src/branding.generated.ts and packages/config/assets/favicons/site.webmanifest
 *
 * Usage:
 *   vp run gen:branding
 *   tsx packages/config/scripts/gen-branding.ts
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  assertBranding,
  renderBrandingModule,
  renderWebManifest,
  type Branding,
} from "../src/gen-branding";

const PACKAGE_DIR = resolve(import.meta.dirname, "..");
const BRANDING_JSON = join(PACKAGE_DIR, "branding.json");
const OUTPUT = join(PACKAGE_DIR, "src/branding.generated.ts");
const MANIFEST = join(PACKAGE_DIR, "assets/favicons/site.webmanifest");

export function writeBrandingGenerated(branding: Branding, outputPath: string = OUTPUT): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderBrandingModule(branding));
}

export function writeWebManifest(branding: Branding, outputPath: string = MANIFEST): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, renderWebManifest(branding));
}

function main(): void {
  if (!existsSync(BRANDING_JSON)) {
    throw new Error(`Missing ${BRANDING_JSON}`);
  }
  const raw = JSON.parse(readFileSync(BRANDING_JSON, "utf8"));
  const branding = assertBranding(raw);
  writeBrandingGenerated(branding);
  writeWebManifest(branding);
  console.log(`Wrote ${OUTPUT} and ${MANIFEST}`);
}

if (import.meta.main) {
  main();
}
