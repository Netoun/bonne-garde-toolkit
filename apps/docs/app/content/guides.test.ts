import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it } from "vite-plus/test";

import { listGuides } from "./guides";

const adrDir = resolve(process.cwd(), "../../docs/adr");
const userGuideDir = resolve(process.cwd(), "../../docs/guides");
const gettingStarted = resolve(userGuideDir, "getting-started.md");

describe("listGuides", () => {
  afterEach(() => {
    rmSync(gettingStarted, { force: true });
  });

  it("lists Internals and Decisions only when no user guides exist", async () => {
    const sections = await listGuides();

    expect(sections.map((section) => section.title)).toEqual(["Internals", "Decisions"]);
    const hrefs = sections.flatMap((section) => section.links.map((link) => link.href));
    expect(hrefs).toContain("/docs/cli");
  });

  it("lists Guides first when a user guide file exists", async () => {
    mkdirSync(userGuideDir, { recursive: true });
    writeFileSync(gettingStarted, "# Getting started\n\nHello.\n");

    const sections = await listGuides();

    expect(sections[0]?.title).toBe("Guides");
    expect(sections[0]?.links[0]?.href).toBe("/docs/guides/getting-started");
    expect(sections[1]?.title).toBe("Internals");
    expect(sections[2]?.title).toBe("Decisions");
  });

  it("lists the 7 internal guides in order, titled by their first heading", async () => {
    const internals = (await listGuides()).find((section) => section.title === "Internals");

    expect(internals?.links).toEqual([
      { title: "Concepts", href: "/docs/concepts" },
      { title: "CLI behaviour", href: "/docs/cli" },
      { title: "Writing a module", href: "/docs/modules" },
      { title: "Project manifest (`bg.json`)", href: "/docs/manifest" },
      { title: "Release and upgrades", href: "/docs/release" },
      { title: "Design system & theming", href: "/docs/design" },
      { title: "Environment Variables", href: "/docs/environment" },
    ]);
  });

  it("lists one decision per docs/adr file", async () => {
    const files = readdirSync(adrDir).filter((file) => file.endsWith(".md"));
    const decisions = (await listGuides()).find((section) => section.title === "Decisions");

    expect(decisions?.links.map((link) => link.href)).toEqual(
      files.map((file) => `/docs/adr/${file.slice(0, -3)}`),
    );
    expect(decisions?.links[0]).toEqual({
      title: "1. One repository, an empty base, a CLI and two catalogs",
      href: "/docs/adr/0001-single-repository-empty-base",
    });
  });
});
