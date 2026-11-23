import { describe, expect, it } from "vite-plus/test";

import { listNav } from "../nav.server";
import { listGuideSources, listPublishedSources } from "./guide-source";
import {
  buildGuideMarkdownCopy,
  buildLlmsFull,
  buildLlmsIndex,
  joinBasePath,
  LLMS_SUMMARY,
  LLMS_TITLE,
  pageDescriptions,
} from "./llms";

const NEXT = "/bonne-garde-toolkit/next/";

describe("llms generator", () => {
  it("builds llms.txt with the H1, summary, nav links and base-prefixed URLs", async () => {
    const sections = await listNav();
    const descriptions = await pageDescriptions(NEXT);
    const llms = buildLlmsIndex(sections, descriptions, NEXT);

    expect(llms.startsWith(`# ${LLMS_TITLE}\n\n> ${LLMS_SUMMARY}\n`)).toBe(true);

    for (const section of sections) {
      for (const link of section.links) {
        const path = link.href.replace(/^\//, "");
        const fragment = link.href.startsWith("/docs/")
          ? `(/bonne-garde-toolkit/next/${path}.md)`
          : `(/bonne-garde-toolkit/next/${path})`;
        expect(llms).toContain(fragment);
      }
    }

    expect(llms.match(/\]\(\.\//g)).toBeNull();
    expect(llms.match(/^- .+:\s*$/m)).toBeNull();
    expect(llms).toContain(
      "- [Concepts](/bonne-garde-toolkit/next/docs/concepts.md): What the platform is made of",
    );
    expect(llms).toContain(
      "- [Release and upgrades](/bonne-garde-toolkit/next/docs/release.md): One semver versions the whole platform",
    );
  });

  it("rewrites published guide links with the base path in md copies and llms-full.txt", () => {
    const concepts = listGuideSources().find((source) => source.file === "docs/CONCEPTS.md");
    expect(concepts).toBeDefined();

    const md = buildGuideMarkdownCopy(concepts!, NEXT);
    expect(md).toContain("](/bonne-garde-toolkit/next/docs/modules#tier-3-intentions)");

    const full = buildLlmsFull(listPublishedSources(), NEXT);
    expect(full).toContain("](/bonne-garde-toolkit/next/docs/modules#tier-3-intentions)");
    expect(full.match(/\]\(\.\//g)).toBeNull();
  });

  it("joins base paths without duplicate slashes", () => {
    expect(joinBasePath("/bonne-garde-toolkit/next/", "docs/concepts.md")).toBe(
      "/bonne-garde-toolkit/next/docs/concepts.md",
    );
    expect(joinBasePath("/", "docs/concepts.md")).toBe("/docs/concepts.md");
  });
});
