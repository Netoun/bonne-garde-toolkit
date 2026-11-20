import { render, screen, within } from "@testing-library/react";
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
  it("renders no sidebar navigation on /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SiteLayout sections={SECTIONS} showSidebar={false}>
          <div>Home</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    expect(screen.queryByRole("navigation", { name: /sidebar/i })).not.toBeInTheDocument();
    expect(document.querySelector('[data-slot="sidebar-container"]')).not.toBeInTheDocument();
  });

  it("renders sidebar navigation on /docs/introduction", () => {
    render(
      <MemoryRouter initialEntries={["/docs/introduction"]}>
        <SiteLayout sections={SECTIONS} showSidebar>
          <div>Guide</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    expect(document.querySelector('[data-slot="sidebar-container"]')).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Introduction" })).toBeInTheDocument();
  });

  it("renders each section title and link href in the sidebar", () => {
    render(
      <MemoryRouter initialEntries={["/docs/introduction"]}>
        <SiteLayout sections={SECTIONS} showSidebar>
          <div>Page body</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    const sidebar = document.querySelector('[data-slot="sidebar-container"]');
    expect(sidebar).toBeTruthy();
    const sidebarScope = within(sidebar as HTMLElement);

    const groupTitles = [
      ...(sidebar as HTMLElement).querySelectorAll('[data-slot="sidebar-group-label"]'),
    ].map((el) => el.textContent);
    for (const section of SECTIONS) {
      expect(groupTitles).toContain(section.title);
      for (const link of section.links) {
        expect(sidebarScope.getByRole("link", { name: link.title })).toHaveAttribute(
          "href",
          link.href,
        );
      }
    }
    expect(sidebar).toHaveClass("top-14");
    expect(sidebar).toHaveClass("h-[calc(100svh-3.5rem)]");
  });
});
