import { defineConfig } from "vite-plus";

/**
 * Root Vite+ config of the platform repository: lint / fmt / staged, and the lint rules that hold
 * the code the registry ships (registry/**), which only runs once `bg add` has copied it into a
 * project. A generated project gets its own config from the tooling/vite-plus module.
 */
export default defineConfig({
  lint: {
    ignorePatterns: [
      "node_modules/",
      "dist/",
      "build/",
      ".wrangler/",
      ".react-router/",
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
      // docs/RULES.md › Types: no @ts-ignore / @ts-expect-error without a justification.
      "typescript/ban-ts-comment": [
        "error",
        { "ts-ignore": "allow-with-description", "ts-expect-error": "allow-with-description" },
      ],
    },
    overrides: [
      {
        // React sources the registry ships — plugins replace the base list: the web modules' apps,
        // the feature items, and the UI items and the ui module's package.
        files: [
          "registry/modules/web/*/template/apps/**",
          "registry/features/**",
          "registry/modules/ui/*/template/packages/ui/**",
          "registry/ui/**",
        ],
        plugins: ["typescript", "import", "unicorn", "react", "node"],
        env: {
          browser: true,
          es2022: true,
        },
      },
      {
        // Programs whose stderr and stdout are their interface: this repo's scripts, the entry
        // files of `bg`, and the scripts the modules ship. The generated project turns the rule off
        // for the same two script directories (tooling/vite-plus), so the template is held to what
        // the project it lands in is held to.
        files: [
          "scripts/**",
          "packages/cli/src/cli.ts",
          "packages/cli/src/bin.ts",
          "packages/cli/src/create-bin.ts",
          "registry/modules/*/*/template/scripts/**",
          "registry/modules/*/*/template/packages/config/scripts/**",
        ],
        rules: {
          "no-console": "off",
        },
      },
      {
        // Front conventions (AGENTS.md › Non-negotiables, docs/RULES.md › Product conventions).
        // A rule only runs where its plugin is listed in the same override: react for forbid-elements.
        files: ["registry/modules/web/*/template/apps/**", "registry/features/**"],
        plugins: ["typescript", "import", "unicorn", "react", "node"],
        rules: {
          "no-restricted-globals": [
            "error",
            { name: "fetch", message: "call the API through Eden Treaty, never raw fetch" },
          ],
          "no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "better-auth",
                  message: "fronts use the better-auth client → import from better-auth/react",
                },
                {
                  name: "@sinclair/typebox",
                  message: "TypeBox validates API input only → validate client input with Zod",
                },
                {
                  name: "react-router",
                  importNames: ["AppLoadContext"],
                  message:
                    "loaders receive RouterContextProvider → read bindings from cloudflareContext",
                },
              ],
              patterns: [
                {
                  group: [
                    "jotai",
                    "valtio",
                    "redux",
                    "react-redux",
                    "@reduxjs/*",
                    "recoil",
                    "mobx",
                  ],
                  message: "client state is Zustand only (docs/RULES.md › Product conventions)",
                },
              ],
            },
          ],
          "react/forbid-elements": [
            "error",
            {
              forbid: [
                { element: "button", message: "compose the Button primitive of packages/ui" },
                { element: "input", message: "compose the Input primitive of packages/ui" },
                { element: "select", message: "compose the Select primitive of packages/ui" },
                { element: "textarea", message: "compose the Textarea primitive of packages/ui" },
              ],
            },
          ],
        },
      },
      {
        // Component files are kebab-case (AGENTS.md › Do).
        files: [
          "registry/modules/web/*/template/apps/**",
          "registry/features/**",
          "registry/modules/ui/*/template/packages/ui/**",
          "registry/ui/**",
        ],
        rules: {
          "unicorn/filename-case": ["error", { case: "kebabCase" }],
        },
      },
      {
        // API conventions: TypeBox input, no Cloudflare API outside the DB / BUCKET bindings.
        files: ["registry/modules/api/*/template/apps/api/**"],
        rules: {
          "no-restricted-imports": [
            "error",
            {
              paths: [
                {
                  name: "zod",
                  message: "Elysia input is validated with TypeBox → use t from elysia",
                },
              ],
              patterns: [
                {
                  group: ["cloudflare:*"],
                  message:
                    "Cloudflare APIs only through the DB / BUCKET bindings (AGENTS.md › Key decisions)",
                },
              ],
            },
          ],
        },
      },
      {
        // docs/TESTING.md › Prohibitions.
        files: ["**/*.test.ts", "**/*.test.tsx"],
        rules: {
          "no-restricted-properties": [
            "error",
            {
              object: "vi",
              property: "mock",
              message: "no module mocking → intercept HTTP with MSW, or inject the dependency",
            },
            {
              object: "vi",
              property: "doMock",
              message: "no module mocking → intercept HTTP with MSW, or inject the dependency",
            },
            {
              object: "mock",
              property: "module",
              message: "no module mocking → intercept HTTP with MSW, or inject the dependency",
            },
            {
              object: "globalThis",
              property: "fetch",
              message: "no hand-mocked fetch → MSW on the front, treaty(app) on the API",
            },
            {
              property: "toMatchSnapshot",
              message: "no snapshot tests → assert what the user sees",
            },
            {
              property: "toMatchInlineSnapshot",
              message: "no snapshot tests → assert what the user sees",
            },
            {
              property: "toThrowErrorMatchingSnapshot",
              message: "no snapshot tests → assert the error",
            },
            {
              property: "toThrowErrorMatchingInlineSnapshot",
              message: "no snapshot tests → assert the error",
            },
          ],
        },
      },
      {
        // API tests call the app through treaty(app), never a launched server.
        files: ["registry/modules/api/*/template/apps/api/**/*.test.ts"],
        rules: {
          "no-restricted-globals": [
            "error",
            { name: "fetch", message: "test the API through treaty(app) (docs/TESTING.md)" },
          ],
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
