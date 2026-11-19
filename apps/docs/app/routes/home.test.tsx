import { Button } from "@acme/ui/components/button";
import { render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vite-plus/test";

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

  it("renders the registry Button through the @acme/ui alias", () => {
    render(<Button>Probe</Button>);
    expect(screen.getByRole("button", { name: "Probe" })).toBeInTheDocument();
  });
});
