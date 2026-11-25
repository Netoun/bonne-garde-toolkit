import { Button } from "@acme/ui/components/button";
import { render, screen, waitFor, within } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import { SiteLayout } from "../components/site-layout";
import type { Route } from "./+types/home";
import Home, { loader as homeLoader, meta } from "./home";

describe("Home", () => {
  it("shows hero, quick start, calls to action and toolkit cards", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: Home, loader: homeLoader }]);
    render(<Stub initialEntries={["/"]} />);

    await waitFor(() => {
      expect(document.body).toHaveTextContent("bunx bonne-garde create my-app");
    });

    expect(screen.getByRole("heading", { level: 1, name: "Bonne Garde" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Get started" })).toHaveAttribute(
      "href",
      "/docs/introduction",
    );
    expect(screen.getByRole("link", { name: "Browse components" })).toHaveAttribute(
      "href",
      "/components/button",
    );
    expect(screen.getByRole("link", { name: /Base template & CLI/i })).toHaveAttribute(
      "href",
      "/docs/introduction",
    );
    expect(screen.getByRole("link", { name: /UI Components/i })).toHaveAttribute(
      "href",
      "/components/button",
    );
    expect(screen.getByRole("link", { name: /Full-stack modules/i })).toHaveAttribute(
      "href",
      "/modules/ui/shadcn",
    );
  });

  it("lists the toolkit paths as three numbered steps under an eyebrow", async () => {
    const Stub = createRoutesStub([{ path: "/", Component: Home, loader: homeLoader }]);
    render(<Stub initialEntries={["/"]} />);

    const steps = await screen.findByRole("list", { name: "Toolkit" });
    expect(steps.tagName).toBe("OL");
    expect(within(steps).getAllByRole("listitem")).toHaveLength(3);
    expect(screen.getByText("Base template · CLI · Registry")).toBeInTheDocument();
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

  it("titles the page Bonne Garde with the home description", () => {
    const tags = meta({} as Route.MetaArgs);

    expect(tags).toContainEqual({ title: "Bonne Garde" });
    expect(tags).toContainEqual({
      name: "description",
      content: expect.stringContaining("shadcn-inspired toolkit"),
    });
  });
});
