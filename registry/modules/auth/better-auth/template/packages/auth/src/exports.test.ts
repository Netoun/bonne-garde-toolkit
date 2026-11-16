import { describe, it, expect } from "bun:test";
// `bg add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { authModule, createAuth, type Auth } from "{{SCOPE}}/auth";
// oxfmt-ignore
import { AUTH_BASE_PATH, type Auth as ClientAuth } from "{{SCOPE}}/auth/client";
// oxfmt-ignore
import { user } from "{{SCOPE}}/auth/schema";
// oxfmt-ignore
import { createTestAuth } from "{{SCOPE}}/auth/testing";

// The rest of the project reaches auth by the package name: `apps/api` for the module, the fronts
// for the client, `packages/db` for the schema, other modules' tests for the helper. Nothing else
// in this package imports these subpaths that way, so a typecheck and a test run are what catch
// one missing from `exports`.
describe("the subpaths the rest of the project imports", () => {
  it("resolves . to the module and the factory, and Auth to its type", () => {
    const handler: Auth["handler"] | undefined = undefined;

    expect(authModule).toBeDefined();
    expect(typeof createAuth).toBe("function");
    expect(handler).toBeUndefined();
  });

  it("resolves ./client to the base path and the same Auth type", () => {
    const handler: ClientAuth["handler"] | undefined = undefined;

    expect(AUTH_BASE_PATH.startsWith("/")).toBe(true);
    expect(handler).toBeUndefined();
  });

  it("resolves ./schema to the tables and ./testing to the helper", () => {
    expect(user).toBeDefined();
    expect(typeof createTestAuth).toBe("function");
  });
});
