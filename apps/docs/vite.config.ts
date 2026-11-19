import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite-plus";

const registryUi = fileURLToPath(new URL("../../registry/ui", import.meta.url));
const registryLoader = fileURLToPath(
  new URL("../../packages/registry/src/load-registry.ts", import.meta.url),
);
const docsImporter = fileURLToPath(new URL("./app/root.tsx", import.meta.url));

/**
 * `registry/ui` is consumed in place, never copied. Bun's isolated linker installs nothing above
 * `apps/docs`, so a bare import of `@base-ui/react`, `motion`… from a registry file would find no
 * package. Re-resolve it as if `apps/docs` wrote it, so the docs' own dependencies are used.
 */
function registryUiDependencies(): Plugin {
  return {
    name: "docs:registry-ui-dependencies",
    enforce: "pre",
    async resolveId(source, importer, options) {
      if (
        !importer?.startsWith(registryUi) ||
        /^[./]/.test(source) ||
        source.startsWith("@acme/")
      ) {
        return null;
      }
      return this.resolve(source, docsImporter, { ...options, skipSelf: true });
    },
  };
}

export default defineConfig(({ mode }) => ({
  plugins: [registryUiDependencies(), ...(mode === "test" ? [] : [tailwindcss(), reactRouter()])],
  test: {
    environment: "jsdom",
    setupFiles: ["./testing/frontend.setup.ts"],
    include: ["app/**/*.test.{ts,tsx}"],
  },
  resolve: {
    alias: [
      // The docs only read the catalog. The package index also exports the patch engine, whose
      // `ts-morph` dependency does not evaluate in the prerender's server bundle.
      { find: /^@bonne-garde\/registry$/, replacement: registryLoader },
      { find: /^@acme\/ui\/components\/(.+)$/, replacement: `${registryUi}/$1.tsx` },
      { find: /^@acme\/ui\/(lib|hooks)\/(.+)$/, replacement: `${registryUi}/$2.ts` },
    ],
  },
  server: {
    fs: { allow: [searchForWorkspaceRoot(process.cwd())] },
  },
}));
