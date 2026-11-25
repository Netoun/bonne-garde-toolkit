import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

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

    for (const section of SECTIONS) {
      const firstLink = sidebarScope.getByRole("link", { name: section.links[0]!.title });
      const header = firstLink
        .closest('[data-sidebar="menu-sub"]')
        ?.closest('[data-sidebar="menu-item"]')
        ?.querySelector('[data-sidebar="menu-button"]');
      expect(header).toBeTruthy();
      expect(within(header as HTMLElement).getByText(section.title)).toBeInTheDocument();
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

  it("ends a doc page with links to its neighbours, in sidebar order", () => {
    render(
      <MemoryRouter initialEntries={["/docs/cli"]}>
        <SiteLayout sections={SECTIONS} showSidebar>
          <div>Guide</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    const pager = screen.getByRole("navigation", { name: "Previous and next pages" });
    expect(within(pager).getByRole("link", { name: /Introduction/ })).toHaveAttribute(
      "href",
      "/docs/introduction",
    );
    expect(within(pager).getByRole("link", { name: /Button/ })).toHaveAttribute(
      "href",
      "/components/button",
    );
  });

  describe("unreleased banner on layout routes", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    it("shows the banner on / and on a doc page when the next build is active", () => {
      vi.stubEnv("BASE_URL", "/bonne-garde-toolkit/next/");

      const { unmount: unmountHome } = render(
        <MemoryRouter initialEntries={["/"]}>
          <SiteLayout sections={SECTIONS} showSidebar={false}>
            <div>Home</div>
          </SiteLayout>
        </MemoryRouter>,
      );
      expect(screen.getByRole("note", { name: "Unreleased version" })).toBeInTheDocument();
      unmountHome();

      render(
        <MemoryRouter initialEntries={["/docs/introduction"]}>
          <SiteLayout sections={SECTIONS} showSidebar>
            <div>Guide</div>
          </SiteLayout>
        </MemoryRouter>,
      );
      expect(screen.getByRole("note", { name: "Unreleased version" })).toBeInTheDocument();
    });
  });

  it("renders doc sidebar sections with icons, nested sub-menus, and an active link state", () => {
    render(
      <MemoryRouter initialEntries={["/docs/introduction"]}>
        <SiteLayout sections={SECTIONS} showSidebar>
          <div>Guide</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    const sidebar = document.querySelector('[data-slot="sidebar-container"]');
    expect(sidebar).toBeTruthy();
    const sidebarScope = within(sidebar as HTMLElement);

    for (const section of SECTIONS) {
      const firstLink = sidebarScope.getByRole("link", { name: section.links[0]!.title });
      const header = firstLink
        .closest('[data-sidebar="menu-sub"]')
        ?.closest('[data-sidebar="menu-item"]')
        ?.querySelector('[data-sidebar="menu-button"]');
      expect(header?.querySelector("svg")).toBeTruthy();

      for (const link of section.links) {
        const anchor = sidebarScope.getByRole("link", { name: link.title });
        expect(anchor.closest('[data-sidebar="menu-sub"]')).toBeTruthy();
      }
    }

    expect(sidebarScope.getByRole("link", { name: "Introduction" })).toHaveAttribute("data-active");
  });

  it("uses the fallback icon for section titles missing from the icon map", () => {
    const sectionsWithMystery: NavSection[] = [
      ...SECTIONS,
      { title: "Mystery", links: [{ title: "Unknown", href: "/docs/unknown" }] },
    ];

    render(
      <MemoryRouter initialEntries={["/docs/unknown"]}>
        <SiteLayout sections={sectionsWithMystery} showSidebar>
          <div>Guide</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    const sidebar = document.querySelector('[data-slot="sidebar-container"]');
    const mysteryLink = within(sidebar as HTMLElement).getByRole("link", { name: "Unknown" });
    const header = mysteryLink
      .closest('[data-sidebar="menu-sub"]')
      ?.closest('[data-sidebar="menu-item"]')
      ?.querySelector('[data-sidebar="menu-button"]');
    const icon = header?.querySelector("svg");
    expect(icon).toBeTruthy();
    expect(icon?.querySelector('[d*="M20 20a2 2 0 0 0 2-2V8"]')).toBeTruthy();
  });

  it("renders no pager on /", () => {
    render(
      <MemoryRouter initialEntries={["/"]}>
        <SiteLayout sections={SECTIONS} showSidebar={false}>
          <div>Home</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("navigation", { name: "Previous and next pages" }),
    ).not.toBeInTheDocument();
  });
});
