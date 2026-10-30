import { defineConfig } from "vite-plus";

/**
 * Root Vite+ config: the lint rules, the fmt options and the staged-files check of every workspace.
 * An app that builds with Vite keeps its own `vite.config.ts`; it does not carry lint or fmt.
 * The fmt options are the ones registry items are formatted with, so vendored files pass
 * `bun run check` as installed.
 */
export default defineConfig({
  lint: {
    ignorePatterns: [
      "node_modules/",
      "dist/",
      "build/",
      ".wrangler/",
      ".react-router/",
      ".bg/",
      "coverage/",
      ".agents/skills/",
      ".claude/skills/",
      ".claude/worktrees/",
      "*.min.js",
      "*.lock",
      "*.lockb",
      ".DS_Store",
    ],
    plugins: ["typescript", "import", "unicorn", "node"],
    env: {
      es2022: true,
      node: true,
    },
    rules: {
      "@typescript-eslint/no-unused-vars": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "no-console": "warn",
      "no-debugger": "error",
      "unicorn/prefer-string-slice": "warn",
    },
    overrides: [
      {
        // Generated React code lands at 035's fixed homes: a `web` module in `apps/<id>`, the shadcn
        // items in `packages/ui`. An override's plugins replace the base list, and enabling one
        // switches none of its rules on, so the rules are named.
        files: ["apps/*/**", "packages/ui/**"],
        excludeFiles: ["apps/api/**"],
        plugins: ["typescript", "import", "unicorn", "react", "node"],
        env: {
          browser: true,
          es2022: true,
        },
        rules: {
          "react/jsx-key": "error",
          "react/jsx-no-duplicate-props": "error",
          "react/jsx-no-undef": "error",
          "react/no-children-prop": "error",
          "react/rules-of-hooks": "error",
        },
      },
      {
        // `api` is server code, `portless` writes `scripts/dev-portless.ts` and `config/branding`
        // writes `packages/config/scripts/gen-branding.ts`: all three print.
        files: ["apps/api/**", "scripts/**", "packages/config/scripts/**"],
        rules: {
          "no-console": "off",
        },
      },
    ],
  },
  fmt: {
    ignorePatterns: [
      "node_modules/",
      "dist/",
      "build/",
      ".wrangler/",
      ".react-router/",
      ".bg/",
      "packages/db/migrations/",
      "coverage/",
      ".agents/skills/",
      ".claude/skills/",
      ".claude/worktrees/",
      "*.lock",
      "bun.lock",
    ],
    printWidth: 100,
    tabWidth: 2,
    singleQuote: false,
    semi: true,
    trailingComma: "all",
    sortPackageJson: true,
  },
  staged: {
    "*.{ts,tsx,js,jsx,mjs,cjs}": "vp check --fix",
  },
});
