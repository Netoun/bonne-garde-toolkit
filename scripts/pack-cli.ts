#!/usr/bin/env bun
/**
 * Build a publishable npm package at dist/npm/create-bonne-garde.
 * Bundles CLI + schema + registry + templates/base (no workspace: deps).
 */
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist/npm/create-bonne-garde");

async function walkFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      files.push(...(await walkFiles(path)));
    } else {
      files.push(path);
    }
  }
  return files;
}

function rewriteImports(source: string): string {
  return source
    .replaceAll('from "@bonne-garde/schema"', 'from "../lib/schema/index.ts"')
    .replaceAll('from "@bonne-garde/registry"', 'from "../lib/registry/index.ts"')
    .replaceAll('from "@bonne-garde/schema"', 'from "../lib/schema/index.ts"');
}

async function rewriteFileImports(filePath: string): Promise<void> {
  if (!filePath.endsWith(".ts")) return;
  const original = await readFile(filePath, "utf8");
  let next = original
    .replaceAll('from "@bonne-garde/schema"', 'from "../lib/schema/index.ts"')
    .replaceAll('from "@bonne-garde/registry"', 'from "../lib/registry/index.ts"');

  // schema imports inside registry package
  if (filePath.includes(`${join("lib", "registry")}`)) {
    next = next.replaceAll('from "@bonne-garde/schema"', 'from "../schema/index.ts"');
  }

  if (next !== original) {
    await writeFile(filePath, next, "utf8");
  }
}

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

await cp(join(ROOT, "apps/cli/src"), join(OUT, "src"), { recursive: true });
await cp(join(ROOT, "packages/schema/src"), join(OUT, "lib/schema"), {
  recursive: true,
});
await cp(
  join(ROOT, "packages/schema/project.schema.json"),
  join(OUT, "lib/schema/project.schema.json"),
);
await cp(join(ROOT, "packages/registry/src"), join(OUT, "lib/registry"), {
  recursive: true,
});
await cp(join(ROOT, "templates/base"), join(OUT, "templates/base"), {
  recursive: true,
});
await cp(join(ROOT, "LICENSE"), join(OUT, "LICENSE"));

// Drop tests from the publishable tarball
for (const file of await walkFiles(OUT)) {
  if (file.endsWith(".test.ts")) {
    await rm(file, { force: true });
  }
}

const allFiles = await walkFiles(OUT);
for (const file of allFiles) {
  await rewriteFileImports(file);
}

// Fix registry → schema relative path after generic rewrite
for (const file of await walkFiles(join(OUT, "lib/registry"))) {
  if (!file.endsWith(".ts")) continue;
  const original = await readFile(file, "utf8");
  const next = original
    .replaceAll('from "../lib/schema/index.ts"', 'from "../schema/index.ts"')
    .replaceAll('from "@bonne-garde/schema"', 'from "../schema/index.ts"');
  if (next !== original) {
    await writeFile(file, next, "utf8");
  }
}

const pkg = {
  name: "create-bonne-garde",
  version: "0.1.0",
  description:
    "Bonne Garde CLI — create an empty Bun/Cloudflare monorepo and add modules from a shadcn-compatible registry",
  type: "module",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/Netoun/bonne-garde-boilerplate.git",
    directory: "apps/cli",
  },
  bugs: {
    url: "https://github.com/Netoun/bonne-garde-boilerplate/issues",
  },
  homepage: "https://github.com/Netoun/bonne-garde-boilerplate#readme",
  keywords: [
    "bonne-garde",
    "boilerplate",
    "bun",
    "cloudflare",
    "elysia",
    "shadcn",
    "registry",
    "cli",
  ],
  engines: {
    bun: ">=1.3.0",
    node: ">=22.12.0",
  },
  bin: {
    "create-bonne-garde": "./src/create-bin.ts",
    bg: "./src/bin.ts",
  },
  files: ["src", "lib", "templates", "README.md", "LICENSE"],
  scripts: {
    test: "bun test",
  },
  publishConfig: {
    access: "public",
  },
};

await writeFile(join(OUT, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const readme = `# create-bonne-garde

Scaffold an empty Bonne Garde monorepo, then add UI and full-stack modules from the registry.

## Create

\`\`\`bash
bun create bonne-garde@latest my-app
# or
bunx create-bonne-garde my-app --yes
\`\`\`

## Add modules

\`\`\`bash
cd my-app
bunx bg add api-elysia button --source github:Netoun/bonne-garde-boilerplate
\`\`\`

Requires [Bun](https://bun.sh).
`;

await writeFile(join(OUT, "README.md"), readme);

// Ensure shebangs
for (const bin of ["src/bin.ts", "src/create-bin.ts"]) {
  const path = join(OUT, bin);
  const content = await readFile(path, "utf8");
  if (!content.startsWith("#!/usr/bin/env bun")) {
    await writeFile(path, `#!/usr/bin/env bun\n${content}`);
  }
}

void rewriteImports;
console.log(`packed create-bonne-garde → ${OUT}`);
