#!/usr/bin/env bun
/**
 * Build a publishable npm package at dist/npm/bonne-garde: one JavaScript file for Node ≥ 22.12
 * (and Bun) that bundles the CLI, schema and registry, plus templates/base.
 *
 * Node never strips types inside node_modules, so what is published is JavaScript. The runtime npm
 * dependencies stay external and are declared in the package's `dependencies`; nothing else is
 * needed to run it, and no `workspace:` dependency is left.
 */
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist/npm/bonne-garde");
const BIN = "bin.js";

/** What a workspace package asks npm for, its sibling workspace packages left out: they are bundled. */
async function runtimeDependencies(name: string): Promise<[string, string][]> {
  const manifest: unknown = JSON.parse(
    await readFile(join(ROOT, "packages", name, "package.json"), "utf8"),
  );
  if (
    typeof manifest !== "object" ||
    manifest === null ||
    !("dependencies" in manifest) ||
    typeof manifest.dependencies !== "object" ||
    manifest.dependencies === null
  ) {
    return [];
  }
  return Object.entries(manifest.dependencies).flatMap(([dependency, version]) =>
    typeof version === "string" && !dependency.startsWith("@bonne-garde/")
      ? [[dependency, version] as [string, string]]
      : [],
  );
}

// What the bundled workspace packages depend on is what the packed package has to declare. Read from
// their manifests, so the pin lives in one place.
const dependencies = Object.fromEntries(
  (await Promise.all(["cli", "registry", "schema"].map(runtimeDependencies))).flat(),
);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

const build = await Bun.build({
  entrypoints: [join(ROOT, "packages/cli/src/bin.ts")],
  outdir: OUT,
  naming: BIN,
  target: "node",
  format: "esm",
  external: Object.keys(dependencies),
});
if (!build.success) {
  throw new AggregateError(build.logs, "bundling the CLI failed");
}

// The bin is run by node (`npx`, `pnpm dlx`, `yarn dlx`): the source's shebang is for Bun, and the
// `// @bun` pragma the bundler leaves marks a file that only Bun runs.
const bundle = (await readFile(join(OUT, BIN), "utf8"))
  .replace(/^#!.*\n/, "")
  .replace(/^\/\/ @bun\n/, "");
await writeFile(join(OUT, BIN), `#!/usr/bin/env node\n${bundle}`);
await chmod(join(OUT, BIN), 0o755);

await cp(join(ROOT, "templates/base"), join(OUT, "templates/base"), {
  recursive: true,
});
await cp(join(ROOT, "LICENSE"), join(OUT, "LICENSE"));

const pkg = {
  name: "bonne-garde",
  version: "0.1.0",
  description:
    "Bonne Garde CLI — create an empty Bun/Cloudflare monorepo and add modules from a shadcn-compatible registry",
  type: "module",
  license: "MIT",
  repository: {
    type: "git",
    url: "git+https://github.com/Netoun/bonne-garde-toolkit.git",
    directory: "packages/cli",
  },
  bugs: {
    url: "https://github.com/Netoun/bonne-garde-toolkit/issues",
  },
  homepage: "https://github.com/Netoun/bonne-garde-toolkit#readme",
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
    node: ">=22.12.0",
  },
  // npm rewrites a bin path that starts with `./` at publish, with a warning that reads as an error.
  bin: {
    "bonne-garde": BIN,
  },
  files: [BIN, "templates", "README.md", "LICENSE"],
  dependencies,
  publishConfig: {
    access: "public",
  },
};

await writeFile(join(OUT, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);

const readme = `# bonne-garde

Scaffold an empty Bonne Garde monorepo, then add UI and full-stack modules from the registry.

## Create

\`\`\`bash
bunx bonne-garde create my-app
npx bonne-garde create my-app
pnpm dlx bonne-garde create my-app
yarn dlx bonne-garde create my-app
\`\`\`

## Add modules

\`\`\`bash
cd my-app
bunx bonne-garde add config/branding provider/cloudflare api/elysia ui/shadcn button --source github:Netoun/bonne-garde-toolkit
\`\`\`

The CLI runs on Node ≥ 22.12 and on Bun, with any package manager. The project it generates is a Bun
monorepo: it needs [Bun](https://bun.sh) to install and run. Without Bun, \`create\` writes the files and
tells you to run \`bun install\` once Bun is installed.
`;

await writeFile(join(OUT, "README.md"), readme);

console.log(`packed bonne-garde → ${OUT}`);
