import { Button } from "@acme/ui/components/button";
import { render, screen } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import Home from "./home";

describe("Home", () => {
  it("shows the quick start and links to the sections", () => {
    const Stub = createRoutesStub([{ path: "/", Component: Home }]);
    render(<Stub initialEntries={["/"]} />);

    expect(screen.getByText(/bunx bonne-garde create my-app/)).toBeInTheDocument();
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
