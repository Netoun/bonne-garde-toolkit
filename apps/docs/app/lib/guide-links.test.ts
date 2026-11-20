import { describe, expect, it } from "vite-plus/test";

import { resolveGuideLink } from "./guide-links";

const from = "docs/CONCEPTS.md";
const GITHUB = "https://github.com/Netoun/bonne-garde-toolkit/blob/v";

describe("resolveGuideLink", () => {
  it("maps a link to a published guide to its route and keeps the anchor", () => {
    expect(resolveGuideLink("./MODULES.md#tier-3-intentions", from)).toBe(
      "/docs/modules#tier-3-intentions",
    );
    expect(resolveGuideLink("./adr/0007-lockstep-versioning.md", from)).toBe(
      "/docs/adr/0007-lockstep-versioning",
    );
  });

  it("resolves relative to the linking file", () => {
    expect(resolveGuideLink("../RELEASE.md", "docs/adr/0007-lockstep-versioning.md")).toBe(
      "/docs/release",
    );
  });

  it("sends any other repository file to the tagged GitHub blob", () => {
    expect(resolveGuideLink("./TESTING.md", from)).toMatch(
      new RegExp(`^${GITHUB}\\d+\\.\\d+\\.\\d+[^/]*/docs/TESTING\\.md$`),
    );
    expect(resolveGuideLink("../registry/ui/registry.json", from)).toMatch(
      /\/registry\/ui\/registry\.json$/,
    );
  });

  it("leaves external links, same-page anchors and mailto alone", () => {
    expect(resolveGuideLink("https://example.com/a.md", from)).toBe("https://example.com/a.md");
    expect(resolveGuideLink("#categories", from)).toBe("#categories");
    expect(resolveGuideLink("mailto:a@b.c", from)).toBe("mailto:a@b.c");
  });
});
