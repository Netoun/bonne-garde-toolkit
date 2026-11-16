import { describe, it, expect } from "bun:test";
// `bg add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { ALLOWED_IMAGE_TYPES, R2Error, mediaModule, mediaPlugin } from "{{SCOPE}}/storage";
// oxfmt-ignore
import { medias, mediasRelations } from "{{SCOPE}}/storage/schema";

// The rest of the project reaches storage by the package name: `apps/api` for the module,
// `packages/db`'s schema barrel for the tables. Nothing else in this package imports these subpaths
// that way, so a typecheck and a test run are what catch one missing from `exports`.
describe("the subpaths the rest of the project imports", () => {
  it("resolves . to the module, its factory and what a caller needs to read its errors", () => {
    expect(mediaModule).toBeDefined();
    expect(typeof mediaPlugin).toBe("function");
    expect(new R2Error("x", "INVALID_KEY").code).toBe("INVALID_KEY");
    expect(ALLOWED_IMAGE_TYPES).toContain("image/png");
  });

  it("resolves ./schema to the table and its relations", () => {
    expect(medias).toBeDefined();
    expect(mediasRelations).toBeDefined();
  });
});
