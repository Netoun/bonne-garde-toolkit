import { describe, it, expect } from "vite-plus/test";
// `bonne-garde add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { launchMacro, launchMacroPlugin, launchModule, launchPlugin } from "{{SCOPE}}/launch";
// oxfmt-ignore
import { waitlistEntry, waitlistJoin } from "{{SCOPE}}/launch/schema";

// The rest of the project reaches launch by the package name: `apps/api` for the module, a route that
// guards itself for the macro, `packages/db`'s schema barrel for the tables. Nothing else in this
// package imports these subpaths that way, so a typecheck and a test run are what catch one missing from `exports`.
describe("the subpaths the rest of the project imports", () => {
  it("resolves . to the module, the macro and their factories", () => {
    expect(launchModule).toBeDefined();
    expect(launchMacro).toBeDefined();
    expect(typeof launchPlugin).toBe("function");
    expect(typeof launchMacroPlugin).toBe("function");
  });

  it("resolves ./schema to the two tables", () => {
    expect(waitlistEntry).toBeDefined();
    expect(waitlistJoin).toBeDefined();
  });
});
