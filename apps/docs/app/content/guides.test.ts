import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vite-plus/test";

import { listGuides } from "./guides";

const adrDir = resolve(process.cwd(), "../../docs/adr");

describe("listGuides", () => {
  it("lists the 7 published guides in order, titled by their first heading", async () => {
    const [guides] = await listGuides();

    expect(guides?.title).toBe("Guides");
    expect(guides?.links).toEqual([
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
    const decisions = (await listGuides())[1];

    expect(decisions?.title).toBe("Decisions");
    expect(decisions?.links.map((link) => link.href)).toEqual(
      files.map((file) => `/docs/adr/${file.slice(0, -3)}`),
    );
    expect(decisions?.links[0]).toEqual({
      title: "1. One repository, an empty base, a CLI and two catalogs",
      href: "/docs/adr/0001-single-repository-empty-base",
    });
  });
});
