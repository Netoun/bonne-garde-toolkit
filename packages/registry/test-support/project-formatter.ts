import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Runs the project's own formatter, `vp fmt` with the config `tooling/vite-plus` installs, over
 * files, and returns what it makes of them. A patch has to write what the formatter would write,
 * since a consumer's `bun run check` rejects anything else and `doctor` then reports the file as
 * edited; a test hands the patched text to this and expects it back unchanged.
 */

const ROOT = join(import.meta.dir, "../../..");

export async function formatWithProjectFormatter(
  files: Record<string, string>,
): Promise<Record<string, string>> {
  const dir = await mkdtemp(join(tmpdir(), "bg-project-formatter-"));
  try {
    await symlink(join(ROOT, "node_modules"), join(dir, "node_modules"));
    await writeFile(
      join(dir, "vite.config.ts"),
      await readFile(join(ROOT, "registry/modules/tooling/vite-plus/template/vite.config.ts")),
    );
    // `vp` runs in a package of a workspace: the directory is one, unless a test brings its own package.json.
    await writeFile(join(dir, "package.json"), '{\n  "name": "formatted",\n  "private": true\n}\n');
    for (const [path, text] of Object.entries(files)) {
      await mkdir(dirname(join(dir, path)), { recursive: true });
      await writeFile(join(dir, path), text);
    }
    const proc = Bun.spawn([join(ROOT, "node_modules/.bin/vp"), "fmt", "--write"], {
      cwd: dir,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
    });
    const [code, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
    if (code !== 0) {
      throw new Error(`vp fmt failed (${code}): ${stderr}`);
    }
    return Object.fromEntries(
      await Promise.all(
        Object.keys(files).map(
          async (path) => [path, await readFile(join(dir, path), "utf8")] as const,
        ),
      ),
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
