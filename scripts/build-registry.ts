#!/usr/bin/env bun
/**
 * Flatten source registry into dist/r/*.json (shadcn build-compatible layout).
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { loadLocalRegistry } from "../packages/registry/src/index";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist/r");

const catalog = await loadLocalRegistry(join(ROOT, "registry/registry.json"));
await mkdir(OUT, { recursive: true });

const index = {
  $schema: "https://ui.shadcn.com/schema/registry.json",
  name: catalog.name,
  homepage: catalog.homepage,
  items: catalog.items.map(({ files, ...rest }) => ({
    ...rest,
    files: files?.map(({ content: _c, ...file }) => ({
      ...file,
      // emit path relative to registry root for consumers
      path: file.path.startsWith(catalog.rootDir)
        ? file.path.slice(catalog.rootDir.length + 1)
        : file.path,
    })),
  })),
};

await writeFile(join(OUT, "registry.json"), `${JSON.stringify(index, null, 2)}\n`);

for (const item of catalog.items) {
  const files = [];
  for (const file of item.files ?? []) {
    const content = await readFile(file.path, "utf8");
    files.push({
      path: file.path.startsWith(catalog.rootDir)
        ? file.path.slice(catalog.rootDir.length + 1)
        : file.path,
      type: file.type,
      target: file.target,
      content,
    });
  }
  const payload = {
    $schema: "https://ui.shadcn.com/schema/registry-item.json",
    ...item,
    files,
  };
  await writeFile(join(OUT, `${item.name}.json`), `${JSON.stringify(payload, null, 2)}\n`);
}

console.log(`built ${catalog.items.length} items → ${OUT}`);
