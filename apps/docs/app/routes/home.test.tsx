import { Button } from "@acme/ui/components/button";
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import { SiteLayout } from "../components/site-layout";
import Home, { loader as homeLoader } from "./home";

describe("Home", () => {
  it("shows the quick start and links to the sections", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: Home, loader: homeLoader }]);
    render(<Stub initialEntries={["/"]} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent("bunx bonne-garde create my-app");
    });
    expect(screen.getByRole("link", { name: "Guides" })).toHaveAttribute(
      "href",
      "/docs/introduction",
    );
  });

  it("renders inside the layout's main element, without a second one", async () => {
    const Stub = createRoutesStub([
      {
        path: "/",
        Component: () => (
          <SiteLayout sections={[]} showSidebar={false}>
            <Home />
          </SiteLayout>
        ),
        loader: homeLoader,
      },
    ]);
    render(<Stub initialEntries={["/"]} />);

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Bonne Garde" })).toBeInTheDocument();
    });
    expect(screen.getAllByRole("main")).toHaveLength(1);
  });

  it("renders the registry Button through the @acme/ui alias", () => {
    render(<Button>Probe</Button>);
    expect(screen.getByRole("button", { name: "Probe" })).toBeInTheDocument();
  });
});
