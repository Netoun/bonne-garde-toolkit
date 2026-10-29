import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { createEmptyProjectManifest } from "@bonne-garde/schema";
import {
  DEFAULT_PLATFORM_REMOTE,
  defaultRegistrySource,
  platformPackageVersion,
  templateBaseDir,
} from "./paths";

export type CreateOptions = {
  name: string;
  cwd?: string;
  scope?: string;
  registry?: string;
  git?: boolean;
  install?: boolean;
  yes?: boolean;
};

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function deriveScope(name: string): string {
  const slug = slugify(name);
  return `@${slug || "acme"}`;
}

async function assertEmptyTarget(dir: string): Promise<void> {
  try {
    const entries = await readdir(dir);
    if (entries.length > 0) {
      throw new Error(`directory is not empty: ${dir}`);
    }
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

async function replaceInFile(path: string, replacements: Record<string, string>): Promise<void> {
  let content = await readFile(path, "utf8");
  for (const [from, to] of Object.entries(replacements)) {
    content = content.split(from).join(to);
  }
  await writeFile(path, content, "utf8");
}

export async function createProject(options: CreateOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  const slug = slugify(options.name);
  if (!slug) {
    throw new Error("invalid project name");
  }
  const target = resolve(cwd, options.name === "." ? "." : options.name);
  await assertEmptyTarget(target);
  await mkdir(target, { recursive: true });

  const scope = options.scope ?? deriveScope(slug);
  const registry = options.registry ?? defaultRegistrySource();
  const displayName = options.name === "." ? slug : options.name;

  await cp(templateBaseDir(), target, { recursive: true });

  const gitignoreSrc = join(target, "_gitignore");
  try {
    await rename(gitignoreSrc, join(target, ".gitignore"));
  } catch {
    // optional in older templates
  }

  const replacements = {
    '"name": "acme"': `"name": "${slug}"`,
    "{{DISPLAY_NAME}}": displayName,
    "{{SCOPE}}": scope,
    "@acme": scope,
  };

  await replaceInFile(join(target, "package.json"), replacements);
  await replaceInFile(join(target, "README.md"), replacements);
  await replaceInFile(join(target, "AGENTS.md"), replacements);

  const platformVersion = platformPackageVersion();
  const manifest = createEmptyProjectManifest({
    scope,
    registries: { "@bg": registry },
    platformVersion,
    platformRemote: DEFAULT_PLATFORM_REMOTE,
  });
  await writeFile(join(target, "bg.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  if (options.git !== false) {
    const proc = Bun.spawn(["git", "init"], { cwd: target, stdout: "ignore", stderr: "pipe" });
    await proc.exited;
  }

  if (options.install !== false) {
    const proc = Bun.spawn(["bun", "install"], {
      cwd: target,
      stdout: "inherit",
      stderr: "inherit",
    });
    const code = await proc.exited;
    if (code !== 0) {
      throw new Error("bun install failed");
    }
  }

  return target;
}
