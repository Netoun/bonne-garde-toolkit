import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { join } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { loadLocalRegistry } from "@bonne-garde/registry";
import { createEmptyProjectManifest } from "@bonne-garde/schema";
import { installedNames, renderCatalog, renderItem, renderNoMatch } from "./catalog-view";
import { runCli } from "./cli";
import { findRepoRoot } from "./paths";

const REGISTRY_DIR = join(findRepoRoot() ?? "", "registry");
const catalog = () => loadLocalRegistry(join(REGISTRY_DIR, "registry.json"));
const plain = (text: string) => stripVTControlCharacters(text);

const restores: (() => void)[] = [];
afterEach(() => restores.splice(0).forEach((restore) => restore()));

async function render(installed: string[] = [], width = 80) {
  const { items, modules } = await catalog();
  return plain(
    renderCatalog({
      items,
      modules,
      installed: new Set(installed),
      hasProject: installed.length > 0,
      width,
      runner: "bonne-garde",
    }),
  );
}

describe("renderCatalog", () => {
  test("groups by kind and module category, and no line is wider than the terminal", async () => {
    const out = await render([], 80);
    const lines = out.split("\n");

    expect(out).toMatch(/^UI \(\d+\)$/m);
    expect(out).toMatch(/^Blocks \(\d+\)$/m);
    expect(out).toMatch(/^Modules$/m);
    expect(lines).toContain("  db");
    expect(out).toContain("db/d1");
    expect(Math.max(...lines.map((line) => line.length))).toBeLessThanOrEqual(80);
    expect(out).toContain("…");
  });

  test("marks the installed entries with ✓ before their name, and only those", async () => {
    const out = await render(["button", "db/d1"]);
    const marked = out.split("\n").filter((line) => line.includes("✓ "));

    expect(marked.map((line) => line.trim().split(/\s+/)[1])).toEqual([
      "button",
      "db/d1",
      "installed",
    ]);
    expect(out).toMatch(/✓ button\s/);
    expect(out).toMatch(/✓ db\/d1\s/);
    expect(out).not.toMatch(/✓ card/);
  });

  test("shows no mark and no legend outside a project", async () => {
    expect(await render([])).not.toContain("✓");
  });

  test("ends with the entry count and the add command", async () => {
    const { items, modules } = await catalog();
    const out = await render(["button"]);

    expect(out.trimEnd().split("\n").at(-1)).toBe(
      `✓ installed · ${items.length + modules.length} entries · bonne-garde add <name>`,
    );
  });
});

describe("installedNames", () => {
  test("reads items and modules as <category>/<id> from the manifest, nothing without one", () => {
    const manifest = createEmptyProjectManifest({ scope: "@app", registries: {} });
    manifest.items.button = { source: "@bg" } as never;
    manifest.modules.db = [{ id: "d1" } as never];

    expect([...installedNames(manifest)].sort()).toEqual(["button", "db/d1"]);
    expect(installedNames(null).size).toBe(0);
  });
});

describe("renderNoMatch", () => {
  test("names the query", () => {
    expect(plain(renderNoMatch("zzz"))).toBe('No match for "zzz"');
  });
});

describe("renderItem", () => {
  test("shows the install command and registry-relative paths, never an absolute one", async () => {
    const { items, rootDir } = await catalog();
    const button = items.find((item) => item.name === "button");
    if (button === undefined) {
      throw new Error("button is not in the registry");
    }
    const out = plain(renderItem(button, { rootDir, runner: "bonne-garde", installed: false }));

    expect(out).toContain("bonne-garde add button");
    expect(out).toContain("registry:ui");
    expect(out).toContain("Primary button component.");
    expect(out).toContain("ui/button.tsx");
    expect(out).toContain("packages/ui/src/components/button.tsx");
    expect(out).toContain("utils");
    expect(out).not.toContain(REGISTRY_DIR);
  });
});

describe("bonne-garde list on a terminal", () => {
  async function ttyRun(argv: string[], columns: number) {
    let out = "";
    const log = spyOn(console, "log").mockImplementation(((...args: unknown[]) => {
      out += `${args.join(" ")}\n`;
    }) as never);
    const tty = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    const cols = Object.getOwnPropertyDescriptor(process.stdout, "columns");
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    Object.defineProperty(process.stdout, "columns", { value: columns, configurable: true });
    restores.push(
      () => log.mockRestore(),
      () =>
        tty
          ? Object.defineProperty(process.stdout, "isTTY", tty)
          : delete (process.stdout as never as Record<string, unknown>).isTTY,
      () =>
        cols
          ? Object.defineProperty(process.stdout, "columns", cols)
          : delete (process.stdout as never as Record<string, unknown>).columns,
    );
    const code = await runCli(argv);
    return { code, out: plain(out) };
  }

  test("list renders the grouped catalog", async () => {
    const { code, out } = await ttyRun(["list", "--source", `local:${REGISTRY_DIR}`], 80);

    expect(code).toBe(0);
    expect(out).toContain("UI (");
    expect(out).not.toContain("\t");
  });

  test("--json keeps the TSV on a terminal", async () => {
    const { out } = await ttyRun(
      ["list", "--items", "--json", "--source", `local:${REGISTRY_DIR}`],
      80,
    );

    expect(out).toContain("utils\tregistry:lib\t");
  });

  test("search renders the matches, and says when there is none", async () => {
    const hit = await ttyRun(["search", "button", "--source", `local:${REGISTRY_DIR}`], 80);
    const miss = await ttyRun(["search", "zzzqqq", "--source", `local:${REGISTRY_DIR}`], 80);

    expect(hit.out).toContain("UI (");
    expect(hit.out).toContain("button");
    expect(miss.out).toBe('No match for "zzzqqq"\n');
  });

  test("view renders the item, not JSON", async () => {
    const { out } = await ttyRun(["view", "button", "--source", `local:${REGISTRY_DIR}`], 80);

    expect(out).toContain("bonne-garde add button");
    expect(out).not.toContain('"name"');
    expect(out).not.toContain(REGISTRY_DIR);
  });
});
