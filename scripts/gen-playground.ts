#!/usr/bin/env bun
/**
 * Generate apps/playground from templates/base + MVP registry items.
 */
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { addItems } from "../apps/cli/src/add";
import { createProject } from "../apps/cli/src/create";
import { findRepoRoot } from "../apps/cli/src/paths";

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
  items: ["api-elysia", "button", "config"],
  install: true,
  force: true,
});

console.log(`playground ready at ${resolve(target)}`);
