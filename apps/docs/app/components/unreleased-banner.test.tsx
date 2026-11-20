import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { SiteLayout } from "./site-layout";

function renderSite() {
  render(
    <MemoryRouter>
      <SiteLayout sections={[]}>
        <div>Page body</div>
      </SiteLayout>
    </MemoryRouter>,
  );
}

describe("unreleased banner", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("warns on the next/ build that the published CLI may not install what it shows", () => {
    vi.stubEnv("BASE_URL", "/bonne-garde-toolkit/next/");

    renderSite();

    const banner = screen.getByRole("note", { name: "Unreleased version" });
    expect(banner).toHaveTextContent("published bonne-garde CLI");
    expect(screen.getByRole("link", { name: "released docs" })).toHaveAttribute(
      "href",
      "/bonne-garde-toolkit/",
    );
  });

  it("points a custom-domain next/ build at the site root", () => {
    vi.stubEnv("BASE_URL", "/next/");

    renderSite();

    expect(screen.getByRole("link", { name: "released docs" })).toHaveAttribute("href", "/");
  });

  it("is absent from the release build", () => {
    vi.stubEnv("BASE_URL", "/bonne-garde-toolkit/");

    renderSite();

    expect(screen.queryByRole("note", { name: "Unreleased version" })).not.toBeInTheDocument();
  });
});
