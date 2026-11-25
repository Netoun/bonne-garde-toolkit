import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createMemoryRouter, createRoutesStub, RouterProvider } from "react-router";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { listGuides } from "../content/guides";
import type { Route } from "./+types/guide";
import Guide, { loader, meta } from "./guide";
import { loader as userGuideLoader } from "./user-guide";

async function renderPage(href: string) {
  const Stub = createRoutesStub([{ path: href, Component: Guide, loader }]);
  const view = render(<Stub initialEntries={[href]} />);
  // The loader highlights every code block: give it room when the whole repo's tests run at once.
  await waitFor(
    () => {
      expect(view.container.querySelector("article")).not.toBeNull();
    },
    { timeout: 10_000 },
  );
  return view;
}

describe("guide page", () => {
  let userGuideDir: string;

  beforeEach(() => {
    userGuideDir = mkdtempSync(join(tmpdir(), "bg-guides-"));
    process.env.BG_DOCS_GUIDES_DIR = userGuideDir;
  });

  afterEach(() => {
    delete process.env.BG_DOCS_GUIDES_DIR;
    rmSync(userGuideDir, { recursive: true, force: true });
  });

  it("renders a user guide page with the shared loader", async () => {
    writeFileSync(
      join(userGuideDir, "getting-started.md"),
      "# Getting started\n\nHello from the guide.\n",
    );

    await renderPage("/docs/guides/getting-started");

    expect(screen.getByRole("heading", { name: "Getting started" })).toBeInTheDocument();
    expect(screen.getByText("Hello from the guide.")).toBeInTheDocument();
  });

  it("loads user guide markdown in the prerender loader", async () => {
    writeFileSync(
      join(userGuideDir, "getting-started.md"),
      "# Getting started\n\nHello from the guide.\n",
    );

    const data = await userGuideLoader({
      request: new Request("http://localhost/docs/guides/getting-started"),
    });

    expect(data.title).toBe("Getting started");
    expect(data.markdown).toContain("Hello from the guide.");
  });

  it("lists the h2 and h3 of a page in an On this page navigation", async () => {
    const Stub = createRoutesStub([
      {
        path: "/docs/x",
        Component: Guide,
        loader: () => ({
          title: "X",
          markdown: "# X\n\n## Setup\n\n### Install\n\ntext",
          links: {},
          highlighted: {},
        }),
      },
    ]);
    render(<Stub initialEntries={["/docs/x"]} />);

    const toc = await screen.findByRole("navigation", { name: "On this page" });
    expect(within(toc).getByRole("link", { name: "Setup" })).toHaveAttribute("href", "#setup");
    expect(within(toc).getByRole("link", { name: "Install" })).toHaveAttribute("href", "#install");
  });

  it("shows no On this page navigation when the page has no h2", async () => {
    const Stub = createRoutesStub([
      {
        path: "/docs/x",
        Component: Guide,
        loader: () => ({ title: "X", markdown: "# X\n\ntext", links: {}, highlighted: {} }),
      },
    ]);
    render(<Stub initialEntries={["/docs/x"]} />);

    await screen.findByRole("heading", { name: "X" });
    expect(screen.queryByRole("navigation", { name: "On this page" })).not.toBeInTheDocument();
  });

  it("renders every published page without a dangling link", async () => {
    const hrefs = (await listGuides()).flatMap((section) => section.links.map((l) => l.href));
    expect(hrefs).toHaveLength(7 + 9);

    for (const href of hrefs) {
      const { container, unmount } = await renderPage(href);
      for (const a of container.querySelectorAll("a[href]")) {
        const target = a.getAttribute("href") ?? "";
        if (/^(https?:|mailto:|#)/.test(target)) continue;
        expect(target, `${href} → ${target}`).not.toMatch(/\.md(#.*)?$/);
        expect(hrefs, `${href} → ${target}`).toContain(target.split("#")[0]);
      }
      unmount();
    }
  }, 20_000);

  it("renders the Three tiers table of CONCEPTS.md as a table", async () => {
    await renderPage("/docs/concepts");

    expect(screen.getByRole("heading", { name: "Three tiers" })).toHaveAttribute(
      "id",
      "three-tiers",
    );
    const table = screen
      .getAllByRole("table")
      .find((candidate) => candidate.textContent?.includes("Verbatim file copy"));
    expect(table).toBeDefined();
    expect(
      within(table!)
        .getAllByRole("columnheader")
        .map((th) => th.textContent),
    ).toContain("Tier");
  });

  it("keeps its links under the base path the site is served from", async () => {
    const basename = "/bonne-garde-toolkit/";
    const router = createMemoryRouter([{ path: "/docs/:slug", Component: Guide, loader }], {
      basename,
      initialEntries: [`${basename}docs/concepts`],
    });
    const { container } = render(<RouterProvider router={router} />);
    await waitFor(() => {
      expect(container.querySelector("article")).not.toBeNull();
    });

    const internal = screen.getAllByRole("link", { name: "MODULES.md" })[0];
    expect(internal?.getAttribute("href")).toBe(`${basename}docs/modules`);
    const external = container.querySelector('a[href*="/blob/"]');
    expect(external?.getAttribute("href")).toMatch(/^https:\/\/github\.com\//);
  });

  it("titles the tab with the guide title and the site name", () => {
    const data = { title: "Introduction", markdown: "", links: {}, highlighted: {} };

    expect(meta({ loaderData: data } as unknown as Route.MetaArgs)).toEqual([
      { title: "Introduction · Bonne Garde" },
    ]);
  });
});
