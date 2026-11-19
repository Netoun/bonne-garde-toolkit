import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // The first PGlite of a process compiles its WebAssembly: ~1 s alone, several when the packages test
    // in parallel. The default 5 s is too short for a test or a hook that starts one.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
