import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import type { NavSection } from "../nav";
import { SiteLayout } from "./site-layout";

const SECTIONS: NavSection[] = [
  {
    title: "Guides",
    links: [
      { title: "Introduction", href: "/docs/introduction" },
      { title: "CLI", href: "/docs/cli" },
    ],
  },
  {
    title: "Components",
    links: [
      { title: "Button", href: "/components/button" },
      { title: "Input", href: "/components/input" },
    ],
  },
];

describe("SiteLayout", () => {
  it("renders each section title and link href in the sidebar", () => {
    render(
      <MemoryRouter>
        <SiteLayout sections={SECTIONS}>
          <div>Page body</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    for (const section of SECTIONS) {
      expect(screen.getByText(section.title)).toBeInTheDocument();
      for (const link of section.links) {
        expect(screen.getByRole("link", { name: link.title })).toHaveAttribute("href", link.href);
      }
    }

    const sidebar = document.querySelector('[data-slot="sidebar-container"]');
    expect(sidebar).toHaveClass("top-14");
    expect(sidebar).toHaveClass("h-[calc(100svh-3.5rem)]");
  });
});
