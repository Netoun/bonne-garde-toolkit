import { cp, mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { createEmptyProjectManifest, DEFAULT_PLATFORM_REMOTE } from "@bonne-garde/schema";
import { defaultRegistrySource, platformPackageVersion, templateBaseDir } from "./paths";

export type CreateOptions = {
  name: string;
  cwd?: string;
  scope?: string;
  registry?: string;
  git?: boolean;
  install?: boolean;
  yes?: boolean;
};

/**
 * The longest scope `create` accepts, `@` included. Registry files are formatted for `@acme` and
 * `add` rewrites the scope, which moves line lengths; `scope-format.test.ts` checks that no file
 * wants a different wrap at any scope up to this one. Past it, the first file to want one is a `web`
 * module's tsconfig.json at 74 (its `paths` array), so this keeps clear of that.
 */
export const MAX_SCOPE_LENGTH = 64;

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

/** Files an older template may not carry are skipped rather than failing the whole create. */
async function replaceInFile(path: string, replacements: Record<string, string>): Promise<void> {
  let content: string;
  try {
    content = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const [from, to] of Object.entries(replacements)) {
    content = content.split(from).join(to);
  }
  await writeFile(path, content, "utf8");
}

export async function createProject(options: CreateOptions): Promise<string> {
  const cwd = options.cwd ?? process.cwd();
  // The project is named after the directory it lands in, never after the path that led there:
  // `bg create /tmp/work/my-app` is `my-app`, and `bg create .` is the current directory's name.
  const target = resolve(cwd, options.name);
  const displayName = basename(target);
  const slug = slugify(displayName);
  if (!slug) {
    throw new Error("invalid project name");
  }
  const scope = options.scope ?? deriveScope(slug);
  if (scope.length > MAX_SCOPE_LENGTH) {
    throw new Error(
      `scope ${scope} is ${scope.length} characters and at most ${MAX_SCOPE_LENGTH} are accepted, ` +
        `so that the files \`bg add\` copies stay formatted: pass a shorter one, bg create ${options.name} --scope @name`,
    );
  }
  await assertEmptyTarget(target);
  await mkdir(target, { recursive: true });

  const registry = options.registry ?? defaultRegistrySource();

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

  for (const file of ["package.json", "README.md", "AGENTS.md", "PRODUCT.md", "CONTEXT.md"]) {
    await replaceInFile(join(target, file), replacements);
  }

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
