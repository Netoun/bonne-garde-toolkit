import { afterEach, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("generates the architecture from the workspace packages and the registry tree", () => {
  const root = mkdtempSync(join(tmpdir(), "boilerplate-architecture-"));
  fixtures.push(root);
  mkdirSync(join(root, "scripts"));
  mkdirSync(join(root, "docs"));
  copyFileSync(
    join(import.meta.dir, "gen-architecture.ts"),
    join(root, "scripts/gen-architecture.ts"),
  );
  writeFileSync(
    join(root, "docs/ARCHITECTURE.md"),
    "<!-- GEN:START -->\n<!-- GEN:END -->\nKeep this guidance.\n",
  );
  for (const name of ["cli", "registry", "extra"]) {
    mkdirSync(join(root, "packages", name), { recursive: true });
  }
  for (const [category, id] of [
    ["provider", "cloudflare"],
    ["provider", "dockerfile"],
    ["web", "spa"],
  ] as const) {
    mkdirSync(join(root, "registry/modules", category, id), { recursive: true });
  }
  mkdirSync(join(root, "registry/ui"), { recursive: true });
  writeFileSync(
    join(root, "registry/ui/registry.json"),
    JSON.stringify({ items: [{ name: "button" }, { name: "card" }] }),
  );

  const result = Bun.spawnSync([process.execPath, "scripts/gen-architecture.ts"], { cwd: root });
  expect(result.exitCode).toBe(0);
  const content = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
  expect(content).toContain("3 packages, 3 modules in 2 categories, 2 items");
  expect(content).toContain("| `packages/cli` |");
  expect(content).toContain("| `packages/extra` | — |");
  expect(content).toContain("| `registry/modules/provider` | `cloudflare`, `dockerfile` |");
  expect(content).toContain("| `registry/ui` | 2 items: button, card |");
  expect(content).toContain("| `registry/features` | 0 items |");
  expect(content).toContain("Keep this guidance.");
});
