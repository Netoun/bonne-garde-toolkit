import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const PLUGIN = join(import.meta.dir, "template/oxlint-plugins/structure.js");
const VP = join(import.meta.dir, "../../../../node_modules/.bin/vp");

type Diagnostic = { code: string; message: string };

const ROUTE_HELPERS_IMPORT = `import { index, layout, route } from "@react-router/dev/routes";\n`;

/**
 * Lints a throwaway project whose `apps/web/src/routes.ts` declares `routes`, and whose feature
 * `<f>` declares `fragments[<f>]` in `features/<f>/routes.ts`; returns this rule's messages.
 */
function lintProject(
  routes: string,
  files: string[],
  fragments: Record<string, string> = {},
): string[] {
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
    write("apps/web/src/routes.ts", `${ROUTE_HELPERS_IMPORT}export default [${routes}];\n`);
    for (const file of files) write(`apps/web/src/${file}`);
    for (const [feature, fragment] of Object.entries(fragments)) {
      write(
        `apps/web/src/features/${feature}/routes.ts`,
        `${ROUTE_HELPERS_IMPORT}export default [${fragment}];\n`,
      );
    }

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

  test("a feature's routes.ts is a fragment: the files it declares are routed, and it sits at the feature root", () => {
    const messages = lintProject(
      `index("features/home/pages/home-page.tsx")`,
      [
        "features/home/pages/home-page.tsx",
        "features/auth/pages/auth-layout.tsx",
        "features/auth/pages/auth-login-page.tsx",
      ],
      {
        auth: `layout("features/auth/pages/auth-layout.tsx", [
          route("login", "features/auth/pages/auth-login-page.tsx"),
        ])`,
      },
    );

    expect(messages).toEqual([]);
  });

  test("a fragment's paths follow the same rules, and only features/<f>/routes.ts is a fragment", () => {
    const messages = lintProject(
      `index("features/home/pages/home-page.tsx")`,
      [
        "features/home/pages/home-page.tsx",
        "features/game/pages/room.tsx",
        "features/game/pages/routes.ts",
        "features/game/components/game-lost-page.tsx",
      ],
      { game: `route("r", "features/game/pages/room.tsx")` },
    );

    expect(messages).toEqual(
      [
        "features/game/pages/room.tsx: leaf route → name it *-page.tsx (or *-redirect.tsx if it only redirects)",
        "features/game/pages/room.tsx: start the name with its feature (game-…)",
        "features/game/pages/routes.ts: only route modules live in features/<feature>/pages/ → move it to a subfolder (components/, hooks/, lib/…)",
        "features/game/components/game-lost-page.tsx: -page/-layout/-redirect are reserved for files declared in routes.ts → rename it, or route it",
      ].sort(),
    );
  });
});
