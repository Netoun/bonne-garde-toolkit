import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { favicons } from "{{SCOPE}}/config/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite-plus";

export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [favicons(), tailwindcss(), reactRouter()],
  test: {
    environment: "jsdom",
    setupFiles: ["./testing/frontend.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
  resolve: { tsconfigPaths: true },
  publicDir: "public",
  server: {
    port: 5175,
    fs: {
      allow: [searchForWorkspaceRoot(process.cwd())],
    },
  },
}));
