import { createRequire } from "node:module";
import { dirname } from "node:path";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite-plus";

// The favicons and the web manifest are served from the site root, under their own names: the
// config package's export finds the directory, and `publicDir` copies it as it is into the build.
const resolveFrom = createRequire(import.meta.url);
// oxfmt-ignore
const FAVICONS = dirname(resolveFrom.resolve("{{SCOPE}}/config/assets/favicons/favicon.svg"));

export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [tailwindcss(), reactRouter()],
  test: {
    environment: "jsdom",
    setupFiles: ["./testing/frontend.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    env: { VITE_API_URL: "http://localhost:5172" },
  },
  resolve: { tsconfigPaths: true },
  publicDir: FAVICONS,
  server: {
    port: 5173,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
}));
