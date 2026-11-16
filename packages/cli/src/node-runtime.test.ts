import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

const PACKAGES = join(import.meta.dir, "../..");

/**
 * The packed CLI runs on Node (`npx bonne-garde`), so what it bundles from `cli`, `registry` and
 * `schema` may not reach for what only Bun has. A path no test runs under Node would fail only on
 * a user's machine, so the sources are read rather than run.
 */
const BUN_ONLY = /\bBun\.|from "bun(:[a-z]+)?"|import\.meta\.(dir|path)\b/;

async function runtimeSources(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return runtimeSources(path);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [path] : [];
    }),
  );
  return files.flat();
}

describe("what the packed CLI bundles", () => {
  test("uses nothing that only Bun has", async () => {
    const offending: string[] = [];
    for (const name of ["cli", "registry", "schema"]) {
      for (const file of await runtimeSources(join(PACKAGES, name, "src"))) {
        const source = await readFile(file, "utf8");
        source.split("\n").forEach((line, index) => {
          if (BUN_ONLY.test(line)) {
            offending.push(`${file.slice(PACKAGES.length + 1)}:${index + 1}: ${line.trim()}`);
          }
        });
      }
    }
    expect(offending).toEqual([]);
  });
});
