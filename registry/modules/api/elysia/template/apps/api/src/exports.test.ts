import { describe, it, expect } from "bun:test";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { app, type App } from "{{SCOPE}}/api/app";
import type { ApiRoute } from "{{SCOPE}}/api/lib/eden";

// The fronts reach the API through `type App` and `lib/eden`, by the package name. Nothing else in
// this app imports these two subpaths that way, so a typecheck and a test run are what catch one
// missing from `exports`.
describe("the subpaths the fronts import", () => {
  it("resolves ./app to the app, and App to its type", () => {
    const handle: App["handle"] = app.handle;

    expect(typeof handle).toBe("function");
  });

  it("resolves ./lib/eden to the Eden helper types", () => {
    const route: ApiRoute<string> = "a static route is returned as is";

    expect(route).toBe("a static route is returned as is");
  });
});
