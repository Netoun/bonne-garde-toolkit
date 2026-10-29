import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig, searchForWorkspaceRoot } from "vite-plus";

export default defineConfig(({ mode }) => ({
  plugins: mode === "test" ? [] : [tailwindcss(), reactRouter()],
  test: {
    environment: "jsdom",
    setupFiles: ["../../testing/frontend.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    env: { VITE_API_URL: "http://localhost:5172" },
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
