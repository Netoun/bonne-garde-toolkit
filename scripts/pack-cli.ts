#!/usr/bin/env bun
/**
 * Build a publishable npm package at dist/npm/create-bonne-garde: the CLI, with schema and registry,
 * bundled into JavaScript for Node (040, 070), and templates/base (no workspace: deps).
 */
import { chmod, cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "..");
const OUT = join(ROOT, "dist/npm/create-bonne-garde");
const NODE_SHEBANG = "#!/usr/bin/env node\n";

// Schema and registry are bundled in, so what their `package.json` files depend on is what the
// packed package has to declare. Read from there, so the pin lives in one place.
const registryManifest: unknown = JSON.parse(
  await readFile(join(ROOT, "packages/registry/package.json"), "utf8"),
);
const registryDependencies =
  typeof registryManifest === "object" &&
  registryManifest !== null &&
  "dependencies" in registryManifest &&
  typeof registryManifest.dependencies === "object" &&
  registryManifest.dependencies !== null
    ? Object.entries(registryManifest.dependencies)
    : [];
const dependencies = Object.fromEntries(
  registryDependencies.filter(([name]) => !name.startsWith("@bonne-garde/")),
);

await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

// Node strips no type under node_modules, so what runs is JavaScript. The npm dependencies stay
// outside the bundle: the package declares them, and npm installs them.
const build = await Bun.build({
  entrypoints: [
    join(ROOT, "packages/cli/src/bin.ts"),
    join(ROOT, "packages/cli/src/create-bin.ts"),
  ],
  outdir: join(OUT, "dist"),
  target: "node",
  format: "esm",
  external: Object.keys(dependencies),
  naming: "[name].js",
});
if (!build.success) {
  throw new AggregateError(build.logs, "bundling the CLI failed");
}
for (const bin of ["bin.js", "create-bin.js"]) {
  const path = join(OUT, "dist", bin);
  const source = await readFile(path, "utf8");
  await writeFile(path, NODE_SHEBANG + source.replace(/^#![^\n]*\n/, ""));
  await chmod(path, 0o755);
}

await mkdir(join(OUT, "lib/schema"), { recursive: true });
await cp(
  join(ROOT, "packages/schema/project.schema.json"),
  join(OUT, "lib/schema/project.schema.json"),
);
await cp(join(ROOT, "templates/base"), join(OUT, "templates/base"), {
  recursive: true,
});
await cp(join(ROOT, "LICENSE"), join(OUT, "LICENSE"));

const pkg = {
  name: "create-bonne-garde",
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
    bun: ">=1.3.0",
    node: ">=22.20.0",
  },
  bin: {
    "create-bonne-garde": "./dist/create-bin.js",
    bg: "./dist/bin.js",
  },
  files: ["dist", "lib", "templates", "README.md", "LICENSE"],
  dependencies,
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
npm create bonne-garde@latest my-app
# or
pnpm create bonne-garde my-app
\`\`\`

## Add modules

\`\`\`bash
cd my-app
bunx bg add config/branding provider/cloudflare api/elysia ui/shadcn button --source github:Netoun/bonne-garde-toolkit
\`\`\`

The CLI runs on Node 22.20+ or Bun. The project it creates uses [Bun](https://bun.sh).
`;

await writeFile(join(OUT, "README.md"), readme);

console.log(`packed create-bonne-garde → ${OUT}`);
