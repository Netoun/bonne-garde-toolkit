import { cloudflare } from "@cloudflare/vite-plugin";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { favicons } from "{{SCOPE}}/config/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite-plus";

export default defineConfig(({ mode }) => ({
  plugins:
    mode === "test"
      ? []
      : [
          favicons(),
          cloudflare({ viteEnvironment: { name: "ssr" } }),
          tailwindcss(),
          reactRouter(),
        ],
  test: {
    environment: "jsdom",
    setupFiles: ["./testing/frontend.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: { tsconfigPaths: true },
  server: {
    port: 5174,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
}));
