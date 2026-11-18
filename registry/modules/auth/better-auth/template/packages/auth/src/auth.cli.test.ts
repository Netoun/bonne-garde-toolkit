import { describe, it, expect } from "vite-plus/test";
import pkg from "../package.json";

const packageRoot = new URL("../", import.meta.url);

function scriptOf(name: "auth:generate" | "auth:secret"): string {
  return pkg.scripts[name];
}

describe("auth CLI scripts", () => {
  it("run the auth CLI, at the better-auth version the package depends on", () => {
    expect(pkg.devDependencies.auth).toBe(pkg.dependencies["better-auth"]);
    for (const name of ["auth:generate", "auth:secret"] as const) {
      expect(scriptOf(name)).toMatch(/^auth /);
    }
  });

  // The config module imports Better Auth, the database and the API's lib: the whole graph, which
  // Vitest transforms cold, takes seconds on a busy machine where the root test runs four packages.
  it(
    "generate from a module that exports the instance the CLI looks for",
    { timeout: 30_000 },
    async () => {
      const configPath = scriptOf("auth:generate").match(/--config (\S+)/)?.[1];
      expect(configPath).toBeDefined();

      // The CLI loads the config module and reads `auth.options`; a factory such as `createAuth`
      // makes it exit with "Couldn't read your auth config".
      const loaded: unknown = await import(new URL(configPath ?? "", packageRoot).pathname);

      expect(loaded).toMatchObject({ auth: { options: expect.any(Object) } });
    },
  );

  it("write the schema this package imports", () => {
    expect(scriptOf("auth:generate")).toContain("--output ./src/schema.ts");
  });
});
