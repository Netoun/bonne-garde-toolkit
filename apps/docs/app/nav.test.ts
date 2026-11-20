import { describe, expect, it } from "vite-plus/test";

import { adjacentLinks, type NavSection } from "./nav";

const SECTIONS: NavSection[] = [
  {
    title: "Guides",
    links: [
      { title: "Introduction", href: "/docs/introduction" },
      { title: "CLI", href: "/docs/cli" },
    ],
  },
  { title: "Empty", links: [] },
  {
    title: "Components",
    links: [
      { title: "Button", href: "/components/button" },
      { title: "Input", href: "/components/input" },
    ],
  },
];

describe("adjacentLinks", () => {
  it("gives the first link no previous", () => {
    expect(adjacentLinks(SECTIONS, "/docs/introduction")).toEqual({
      previous: undefined,
      next: { title: "CLI", href: "/docs/cli" },
    });
  });

  it("gives the last link no next", () => {
    expect(adjacentLinks(SECTIONS, "/components/input")).toEqual({
      previous: { title: "Button", href: "/components/button" },
      next: undefined,
    });
  });

  it("crosses a section boundary, skipping an empty section", () => {
    expect(adjacentLinks(SECTIONS, "/components/button").previous).toEqual({
      title: "CLI",
      href: "/docs/cli",
    });
    expect(adjacentLinks(SECTIONS, "/docs/cli").next).toEqual({
      title: "Button",
      href: "/components/button",
    });
  });

  it("matches a trailing slash", () => {
    expect(adjacentLinks(SECTIONS, "/docs/introduction/")).toEqual(
      adjacentLinks(SECTIONS, "/docs/introduction"),
    );
  });

  it("gives nothing for a page outside the sidebar", () => {
    expect(adjacentLinks(SECTIONS, "/")).toEqual({ previous: undefined, next: undefined });
    expect(adjacentLinks(SECTIONS, "/nope")).toEqual({ previous: undefined, next: undefined });
  });
});
