import { defineConfig } from "vite-plus";

/**
 * Root Vite+ config for the monorepo.
 * Shared lint / fmt / staged live here; each app keeps its own vite.config.ts
 * for Vite / React Router / Cloudflare. See https://viteplus.dev/guide/monorepo
 */
export default defineConfig({
  lint: {
    ignorePatterns: [
      "node_modules/",
      "dist/",
      "build/",
      ".wrangler/",
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
      "@typescript-eslint/no-explicit-any": "warn",
      "no-console": "warn",
      "no-debugger": "error",
      "unicorn/prefer-string-slice": "warn",
    },
    overrides: [
      {
        // Front apps + shared React packages — plugins replace the base list.
        files: [
          "apps/spa/**",
          "apps/ssr/**",
          "apps/static/**",
          "packages/ui/**",
          "packages/emails/**",
        ],
        plugins: ["typescript", "import", "unicorn", "react", "node"],
        env: {
          browser: true,
          es2022: true,
        },
      },
      {
        files: ["apps/api/**"],
        plugins: ["typescript", "import", "unicorn", "node"],
        env: {
          node: true,
          es2022: true,
        },
        rules: {
          "no-console": "off",
        },
      },
      {
        files: ["scripts/**"],
        rules: {
          "no-console": "off",
        },
      },
      {
        files: ["**/*.test.ts", "**/*.spec.ts", "**/*.test.tsx", "**/*.spec.tsx"],
        rules: {
          "@typescript-eslint/no-explicit-any": "off",
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
