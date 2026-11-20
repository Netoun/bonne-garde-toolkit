import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router";
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

function LocationProbe() {
  const { pathname } = useLocation();
  return <div data-testid="pathname">{pathname}</div>;
}

function renderSearchLayout(initialPath = "/") {
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <SiteLayout sections={SECTIONS} showSidebar={false}>
        <LocationProbe />
      </SiteLayout>
    </MemoryRouter>,
  );
}

function getSearchDialog() {
  return screen.getByRole("dialog", { name: "Search documentation" });
}

describe("documentation search", () => {
  it("opens the dialog on Ctrl+K, finds Button for but, and navigates on Enter", async () => {
    renderSearchLayout();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });

    const dialog = getSearchDialog();
    const input = within(dialog).getByRole("textbox", { name: "Search documentation" });
    fireEvent.change(input, { target: { value: "but" } });

    expect(within(dialog).getByRole("option", { name: "Button" })).toBeInTheDocument();

    fireEvent.keyDown(input, { key: "Enter" });

    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: "Search documentation" }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByTestId("pathname")).toHaveTextContent("/components/button");
  });

  it("closes on Escape and shows No results. when nothing matches", () => {
    renderSearchLayout();

    fireEvent.keyDown(document, { key: "k", ctrlKey: true });
    const dialog = getSearchDialog();
    const input = within(dialog).getByRole("textbox", { name: "Search documentation" });

    fireEvent.change(input, { target: { value: "zzznomatch" } });
    expect(within(dialog).getByText("No results.")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "Search documentation" })).not.toBeInTheDocument();
  });
});
