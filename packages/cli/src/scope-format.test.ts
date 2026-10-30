import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadLocalRegistry } from "@bonne-garde/registry";
import { addItems } from "./add";
import { createProject, MAX_SCOPE_LENGTH } from "./create";
import { findRepoRoot } from "./paths";

/**
 * Registry files are authored and formatted for `@acme`; `add` rewrites the scope at copy time and
 * records the sha256 of what it wrote. The rewrite changes line lengths, so a formatter that never
 * saw the project's scope can want a different wrap (060). A project that fails its own
 * `bun run check` right after `create` + `add` sends an agent into a format fix that then makes
 * `doctor` report the file as user-modified, so every file must already be what the formatter
 * writes, at any scope a project can have.
 */

/** The scopes the report names: the shortest legal one, the authoring scope, and a long one. */
const NAMED_SCOPES = ["@a", "@app", "@acme", "@golden-app", "@a-much-longer-company-scope"];
/** The modules a single project holds; each other module is installed alone, as it fills a category `one`. */
const SHARED_MODULES = [
  "tooling/vite-plus",
  "config/branding",
  "ui/shadcn",
  "provider/cloudflare",
  "api/elysia",
];
/**
 * The project on the other provider. `provider` admits one module, and the variant of `api/elysia`
 * that is selected depends on it, so the files of the other variant need a tree of their own.
 */
const OTHER_PROVIDER_STACK = ["config/branding", "provider/dockerfile", "api/elysia"];

const dirs: string[] = [];

afterAll(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })));
});

function repoRoot(): string {
  const root = findRepoRoot();
  if (!root) {
    throw new Error("repo root not found");
  }
  return root;
}

/** Every scope of 2 to `MAX_SCOPE_LENGTH` characters, and the named ones, which share some of those lengths. */
function scopeMatrix(): string[] {
  const swept = Array.from(
    { length: MAX_SCOPE_LENGTH - 1 },
    (_, index) => `@${"a".repeat(index + 1)}`,
  );
  return [...new Set([...NAMED_SCOPES, ...swept])];
}

type Rendered = { dir: string; scope: string };

type FormatRun = { code: number; output: string };

async function vp(tree: string, mode: "--check" | "--write"): Promise<FormatRun> {
  const proc = Bun.spawn([join(repoRoot(), "node_modules/.bin/vp"), "fmt", mode], {
    cwd: tree,
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code, output: `${stdout}${stderr}` };
}

/** The paths `vp fmt --check` lists as unformatted: one `<path> (<n>ms)` line each. */
function unformatted(output: string): string[] {
  return output.split("\n").flatMap((line) => {
    const path = /^(\S+) \(\d+ms\)$/.exec(line)?.[1];
    return path === undefined ? [] : [path];
  });
}

/** Where the formatter changed a file: the first line that differs, before and after. */
function firstChange(before: string, after: string): string {
  const was = before.split("\n");
  const now = after.split("\n");
  const index = was.findIndex((line, at) => line !== now[at]);
  return `line ${index + 1}: \`${was[index] ?? ""}\` becomes \`${now[index] ?? ""}\``;
}

/** `[2, 3, 4, 20, 21]` as `2-4, 20-21`. */
function ranges(numbers: number[]): string {
  const sorted = [...numbers].sort((a, b) => a - b);
  const groups: [number, number][] = [];
  for (const value of sorted) {
    const last = groups[groups.length - 1];
    if (last !== undefined && value <= last[1] + 1) {
      last[1] = value;
    } else {
      groups.push([value, value]);
    }
  }
  return groups.map(([from, to]) => (from === to ? `${from}` : `${from}-${to}`)).join(", ");
}

describe("scope rendering and the formatter", () => {
  test("every registry file is format-stable at any scope", async () => {
    const root = repoRoot();
    const registry = `local:${join(root, "registry")}`;
    const catalog = await loadLocalRegistry(join(root, "registry/registry.json"));
    const itemNames = catalog.items.map((item) => item.name);
    const keys = catalog.modules.map(({ manifest }) => `${manifest.category}/${manifest.id}`);
    const unknown = [...SHARED_MODULES, ...OTHER_PROVIDER_STACK].filter(
      (key) => !keys.includes(key),
    );
    expect(unknown).toEqual([]);
    const alone = keys.filter((key) => !SHARED_MODULES.includes(key));

    // One tree for the whole matrix, so that `vp fmt` runs once. Its root carries what the
    // `tooling/vite-plus` module installs, which is the fmt config a consumer's check reads.
    const tree = await mkdtemp(join(tmpdir(), "bg-scope-format-"));
    dirs.push(tree);
    await symlink(join(root, "node_modules"), join(tree, "node_modules"));
    await writeFile(
      join(tree, "package.json"),
      `${JSON.stringify({ name: "scope-format", private: true, workspaces: ["*"] }, null, 2)}\n`,
    );
    await writeFile(
      join(tree, "vite.config.ts"),
      await readFile(join(root, "registry/modules/tooling/vite-plus/template/vite.config.ts")),
    );

    const projects: Rendered[] = [];
    for (const [index, scope] of scopeMatrix().entries()) {
      const installs = [
        { suffix: "all", names: [...SHARED_MODULES, ...itemNames] },
        { suffix: "other-provider", names: OTHER_PROVIDER_STACK },
        ...alone.map((key) => ({ suffix: key.replace("/", "-"), names: [key] })),
      ];
      for (const { suffix, names } of installs) {
        const dir = await createProject({
          name: `s${index}-${suffix}`,
          cwd: tree,
          scope,
          registry,
          git: false,
          install: false,
        });
        await addItems({ projectRoot: dir, items: names, install: false });
        projects.push({ dir, scope });
      }
    }

    const check = await vp(tree, "--check");
    if (check.code === 0) {
      return;
    }
    const failing = unformatted(check.output);
    if (failing.length === 0) {
      throw new Error(`vp fmt --check failed without naming a file:\n${check.output}`);
    }

    // Read what `add` wrote, let the formatter rewrite it, and report where it disagrees: one
    // entry per file, with the scope lengths it fails at and the first change at the shortest one.
    const written = new Map(
      await Promise.all(
        failing.map(async (path) => [path, await readFile(join(tree, path), "utf8")] as const),
      ),
    );
    await vp(tree, "--write");
    const byFile = new Map<string, { scope: string; change: string }[]>();
    for (const path of failing) {
      const project = projects.find(({ dir }) => path.startsWith(`${dir.slice(tree.length + 1)}/`));
      const file = path.slice(path.indexOf("/") + 1);
      const change = firstChange(written.get(path) ?? "", await readFile(join(tree, path), "utf8"));
      byFile.set(file, [...(byFile.get(file) ?? []), { scope: project?.scope ?? "?", change }]);
    }
    const report = [...byFile].map(([file, failures]) => {
      const [first] = [...failures].sort((a, b) => a.scope.length - b.scope.length);
      const lengths = [...new Set(failures.map(({ scope }) => scope.length))];
      return `${file} fails at scope lengths ${ranges(lengths)}; at ${first?.scope}, ${first?.change}`;
    });
    expect(report).toEqual([]);
  }, 120_000);
});
