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

  it("marks the current sidebar link with the docs accent bar", () => {
    render(
      <MemoryRouter initialEntries={["/docs/cli"]}>
        <SiteLayout sections={SECTIONS} showSidebar>
          <div>Guide</div>
        </SiteLayout>
      </MemoryRouter>,
    );

    const sidebar = within(
      document.querySelector('[data-slot="sidebar-container"]') as HTMLElement,
    );
    expect(sidebar.getByRole("link", { name: "CLI" })).toHaveClass("border-docs-accent");
    expect(sidebar.getByRole("link", { name: "Introduction" })).not.toHaveClass(
      "border-docs-accent",
    );
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
