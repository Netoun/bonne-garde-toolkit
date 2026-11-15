import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PLUGIN = join(import.meta.dir, "template/oxlint-plugins/structure.js");
const VP = join(import.meta.dir, "../../../../node_modules/.bin/vp");

type Diagnostic = { code: string; message: string };

/** Lints a throwaway project whose `apps/web/src/routes.ts` declares `routes`; returns this rule's messages. */
function lintProject(routes: string, files: string[]): string[] {
  const dir = mkdtempSync(join(tmpdir(), "bg-structure-"));
  const write = (path: string, text = "export {};\n") => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  try {
    write("package.json", JSON.stringify({ name: "fixture", private: true, type: "module" }));
    write(
      "vite.config.ts",
      `export default { lint: { jsPlugins: [${JSON.stringify(PLUGIN)}], rules: { "structure/route-modules": ["error", { mode: "pages" }] } } };\n`,
    );
    write(
      "apps/web/src/routes.ts",
      `import { index, layout, route } from "@react-router/dev/routes";\nexport default [${routes}];\n`,
    );
    for (const file of files) write(`apps/web/src/${file}`);

    const result = Bun.spawnSync({ cmd: [VP, "lint", "-f", "json"], cwd: dir });
    const { diagnostics } = JSON.parse(result.stdout.toString()) as { diagnostics: Diagnostic[] };
    return diagnostics
      .filter((diagnostic) => diagnostic.code === "structure(route-modules)")
      .map((diagnostic) => diagnostic.message)
      .sort();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

describe("structure/route-modules", () => {
  test("passes route modules named by role, prefixed by feature, all in pages/", () => {
    const messages = lintProject(
      `index("features/home/pages/home-page.tsx"),
       route("r", "features/game/pages/game-room-layout.tsx", [
         route(":id", "features/game/pages/game-room-page.tsx"),
       ])`,
      [
        "features/home/pages/home-page.tsx",
        "features/game/pages/game-room-layout.tsx",
        "features/game/pages/game-room-page.tsx",
        "features/game/hooks/use-game.ts",
      ],
    );

    expect(messages).toEqual([]);
  });

  test("reports each misplaced or misnamed file with its fix", () => {
    const messages = lintProject(
      `route("r", "features/game/game-room-layout.tsx", [
         route(":id", "features/game/pages/game-room-page.tsx"),
       ]),
       layout("features/shell/pages/shell-page.tsx", [index("features/shell/pages/shell-home-page.tsx")]),
       route("login", "features/auth/pages/login.tsx")`,
      [
        "features/game/game-room-layout.tsx",
        "features/game/pages/game-room-page.tsx",
        "features/game/pages/game-card.tsx",
        "features/game/types.ts",
        "features/game/components/game-lost-page.tsx",
        "features/shell/pages/shell-page.tsx",
        "features/shell/pages/shell-home-page.tsx",
        "features/auth/pages/login.tsx",
      ],
    );

    expect(messages).toEqual(
      [
        "features/game/game-room-layout.tsx: route modules live in features/<feature>/pages/",
        "features/shell/pages/shell-page.tsx: has child routes, so it is a layout → name it *-layout.tsx",
        "features/auth/pages/login.tsx: leaf route → name it *-page.tsx (or *-redirect.tsx if it only redirects)",
        "features/auth/pages/login.tsx: start the name with its feature (auth-…)",
        "features/game/pages/game-card.tsx: only route modules live in features/<feature>/pages/ → move it to a subfolder (components/, hooks/, lib/…)",
        "features/game/types.ts: no loose file at a feature root → move it to a subfolder (components/, hooks/, lib/…)",
        "features/game/components/game-lost-page.tsx: -page/-layout/-redirect are reserved for files declared in routes.ts → rename it, or route it",
      ].sort(),
    );
  });
});
