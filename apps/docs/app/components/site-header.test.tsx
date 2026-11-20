import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import { SiteHeader } from "./site-header";

describe("SiteHeader", () => {
  it("renders main nav links with their hrefs", () => {
    render(
      <MemoryRouter>
        <SiteHeader showSidebar={false} sections={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Docs" })).toHaveAttribute(
      "href",
      "/docs/introduction",
    );
    expect(screen.getByRole("link", { name: "Components" })).toHaveAttribute(
      "href",
      "/components/button",
    );
    expect(screen.getByRole("link", { name: "Modules" })).toHaveAttribute(
      "href",
      "/modules/ui/shadcn",
    );
  });

  it("marks only the current section link with aria-current on /components/button", () => {
    render(
      <MemoryRouter initialEntries={["/components/button"]}>
        <SiteHeader showSidebar={false} sections={[]} />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Docs" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Components" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Modules" })).not.toHaveAttribute("aria-current");
  });
});
