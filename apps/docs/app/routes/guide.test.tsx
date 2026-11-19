import { render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import { listGuides } from "../content/guides";
import Guide, { loader } from "./guide";

async function renderPage(href: string) {
  const Stub = createRoutesStub([{ path: href, Component: Guide, loader }]);
  const view = render(<Stub initialEntries={[href]} />);
  await waitFor(() => {
    expect(view.container.querySelector("article")).not.toBeNull();
  });
  return view;
}

describe("guide page", () => {
  it("renders every published page without a dangling link", async () => {
    const hrefs = (await listGuides()).flatMap((section) => section.links.map((l) => l.href));
    expect(hrefs).toHaveLength(7 + 8);

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
  });

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
});
