import { defineConfig } from "vite-plus";

/**
 * Root Vite+ config: shared lint / fmt for every workspace.
 * The fmt options match the ones registry items are formatted with, so vendored files pass
 * `bun run check` as installed.
 */
export default defineConfig({
  lint: {
    ignorePatterns: ["node_modules/", "dist/", "build/", ".wrangler/", ".bg/", "*.lock"],
    plugins: ["typescript", "import", "unicorn", "node"],
  },
  fmt: {
    ignorePatterns: ["node_modules/", "dist/", "build/", ".wrangler/", ".bg/", "bun.lock"],
    printWidth: 100,
    tabWidth: 2,
    singleQuote: false,
    semi: true,
    trailingComma: "all",
    sortPackageJson: true,
  },
});
