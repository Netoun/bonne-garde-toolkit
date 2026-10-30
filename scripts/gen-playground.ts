#!/usr/bin/env bun
/**
 * Generate apps/playground from templates/base + MVP registry items.
 */
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { addItems } from "../packages/cli/src/add";
import { createProject } from "../packages/cli/src/create";
import { findRepoRoot } from "../packages/cli/src/paths";

const ROOT = findRepoRoot();
if (!ROOT) {
  throw new Error("repo root not found");
}
const parent = ROOT;
const name = "playground";
const target = join(parent, name);

await rm(target, { recursive: true, force: true });

await createProject({
  name,
  cwd: parent,
  git: false,
  install: false,
  scope: "@playground",
  registry: `local:${join(ROOT, "registry")}`,
});

await addItems({
  projectRoot: target,
  items: ["tooling/vite-plus", "ui/shadcn", "config/branding", "api-elysia", "button"],
  install: true,
});

console.log(`playground ready at ${resolve(target)}`);
