import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const readme = await Bun.file(join(ROOT, "README.md")).text();

describe("README.md", () => {
  test("every relative link and image points at a file of the repository", () => {
    const targets = [
      ...readme.matchAll(/\]\(([^)\s]+)\)/g),
      ...readme.matchAll(/(?:src|href)="([^"]+)"/g),
    ]
      .map((match) => match[1] ?? "")
      .filter((target) => !/^(https?:|#|mailto:)/.test(target))
      .map((target) => target.split("#")[0] ?? "");

    expect(targets.length).toBeGreaterThan(0);
    expect(targets.filter((target) => !existsSync(join(ROOT, target)))).toEqual([]);
  });

  test("every `bun run <script>` it shows is a script of the root package.json", async () => {
    const { scripts } = (await Bun.file(join(ROOT, "package.json")).json()) as {
      scripts: Record<string, string>;
    };
    const shown = [...readme.matchAll(/bun run ([a-z][\w:-]*)/g)].map((match) => match[1] ?? "");

    expect(shown.length).toBeGreaterThan(0);
    expect([...new Set(shown)].filter((script) => !(script in scripts))).toEqual([]);
  });

  test("every path of the structure block exists", () => {
    const block = /```text\n([\s\S]*?)```/.exec(readme)?.[1] ?? "";
    const paths = block
      .split("\n")
      .map((line) => line.split("#")[0]?.trim() ?? "")
      .filter(Boolean);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.filter((path) => !existsSync(join(ROOT, path)))).toEqual([]);
  });
});
