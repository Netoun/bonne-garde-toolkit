import { describe, it, expect } from "bun:test";
import pkg from "../../../package.json";

const apiRoot = new URL("../../../", import.meta.url);

function scriptOf(name: "auth:generate" | "auth:secret"): string {
  return pkg.scripts[name];
}

describe("auth CLI scripts", () => {
  it("run the auth CLI at the better-auth version the API depends on", () => {
    for (const name of ["auth:generate", "auth:secret"] as const) {
      expect(scriptOf(name)).toContain(`bunx auth@${pkg.dependencies["better-auth"]} `);
    }
  });

  it("generate from a module that exports the instance the CLI looks for", async () => {
    const configPath = scriptOf("auth:generate").match(/--config (\S+)/)?.[1];
    expect(configPath).toBeDefined();

    // The CLI loads the config module and reads `auth.options`; a factory such as `createAuth`
    // makes it exit with "Couldn't read your auth config".
    const loaded: unknown = await import(new URL(configPath ?? "", apiRoot).pathname);

    expect(loaded).toMatchObject({ auth: { options: expect.any(Object) } });
  });
});
