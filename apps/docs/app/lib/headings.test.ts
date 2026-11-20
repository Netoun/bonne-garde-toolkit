import { describe, expect, it } from "vite-plus/test";

import { extractHeadings, slugify } from "./headings";

describe("extractHeadings", () => {
  it("lists h2 and h3 with their anchors, skipping h1 and fenced code", () => {
    const markdown = [
      "# Title",
      "## Setup",
      "```sh",
      "## not a heading",
      "```",
      "### Install `bun`",
      "#### Deep",
      "## See [the docs](./x.md) **now**",
    ].join("\n");

    expect(extractHeadings(markdown)).toEqual([
      { depth: 2, text: "Setup", id: "setup" },
      { depth: 3, text: "Install bun", id: "install-bun" },
      { depth: 2, text: "See the docs now", id: "see-the-docs-now" },
    ]);
  });

  it("slugifies like GitHub", () => {
    expect(slugify("Three tiers")).toBe("three-tiers");
  });
});
