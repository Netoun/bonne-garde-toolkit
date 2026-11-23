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

describe("llms generator", () => {
  it("builds llms.txt with the H1, summary, nav links and base-prefixed URLs", async () => {
    const sections = await listNav();
    const descriptions = await pageDescriptions();
    const llms = buildLlmsIndex(sections, descriptions, "/bonne-garde-toolkit/next/");

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
  });

  it("rewrites published guide links with the base path in md copies and llms-full.txt", () => {
    const concepts = listGuideSources().find((source) => source.file === "docs/CONCEPTS.md");
    expect(concepts).toBeDefined();

    const base = "/";
    const md = buildGuideMarkdownCopy(concepts!, base);
    expect(md).toContain("](/docs/modules#tier-3-intentions)");

    const full = buildLlmsFull(listPublishedSources(), base);
    expect(full).toContain("](/docs/modules#tier-3-intentions)");
    expect(full.match(/\]\(\.\//g)).toBeNull();
  });

  it("joins base paths without duplicate slashes", () => {
    expect(joinBasePath("/bonne-garde-toolkit/next/", "docs/concepts.md")).toBe(
      "/bonne-garde-toolkit/next/docs/concepts.md",
    );
    expect(joinBasePath("/", "docs/concepts.md")).toBe("/docs/concepts.md");
  });
});
