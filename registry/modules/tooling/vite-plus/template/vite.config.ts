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
  },
  fmt: {
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
