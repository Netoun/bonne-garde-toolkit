import { afterEach, expect, it } from "bun:test";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const fixtures: string[] = [];
afterEach(() => {
  for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true });
});

it("generates architecture from the installed router major and deployment mode", () => {
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
  for (const [name, ssr] of Object.entries({ spa: false, ssr: true })) {
    mkdirSync(join(root, "apps", name), { recursive: true });
    writeFileSync(
      join(root, "apps", name, "package.json"),
      JSON.stringify({
        dependencies: { "react-router": "8.3.0" },
        devDependencies: { "@react-router/dev": "8.3.0" },
      }),
    );
    writeFileSync(
      join(root, "apps", name, "react-router.config.ts"),
      `export default { ssr: ${ssr} };`,
    );
  }
  const result = Bun.spawnSync([process.execPath, "scripts/gen-architecture.ts"], { cwd: root });
  expect(result.exitCode).toBe(0);
  const content = readFileSync(join(root, "docs/ARCHITECTURE.md"), "utf8");
  expect(content).toContain("React Router v8 | SPA | Pages");
  expect(content).toContain("React Router v8 | SSR | Workers");
  expect(content).toContain("Keep this guidance.");
});
