import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRoutesStub } from "react-router";
import { describe, expect, it } from "vite-plus/test";

import Item, { loader as itemLoader } from "./item";

const loaderTimeout = { timeout: 10_000 };

function itemStub(initial: string) {
  const Stub = createRoutesStub([
    { path: "/components/:name", Component: Item, loader: itemLoader },
    { path: "/blocks/:name", Component: Item, loader: itemLoader },
  ]);
  return <Stub initialEntries={[initial]} />;
}

describe("Item page", () => {
  it("renders button with Preview and Code showing the component target", async () => {
    render(itemStub("/components/button"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Button" })).toBeInTheDocument();
    }, loaderTimeout);

    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: "Preview" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("tab", { name: "Code" }));
    expect(screen.getByText("packages/ui/src/components/button.tsx")).toBeInTheDocument();
  });

  it("renders separator with Preview and Code tabs", async () => {
    render(itemStub("/components/separator"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Separator" })).toBeInTheDocument();
    }, loaderTimeout);

    expect(screen.getByRole("tab", { name: "Preview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Code" })).toBeInTheDocument();
  });

  it("shows the Installation block for button", async () => {
    render(itemStub("/components/button"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "Installation" })).toBeInTheDocument();
    }, loaderTimeout);

    expect(document.body).toHaveTextContent("bunx bonne-garde add button");
  });

  it("links spa-auth to the auth and web modules it needs", async () => {
    render(itemStub("/blocks/spa-auth"));

    await waitFor(() => {
      expect(screen.getByRole("heading", { name: "SPA auth" })).toBeInTheDocument();
    }, loaderTimeout);

    expect(screen.getByRole("link", { name: "auth" })).toHaveAttribute(
      "href",
      "/modules/auth/better-auth",
    );
    expect(screen.getByRole("link", { name: "web/spa" })).toHaveAttribute(
      "href",
      "/modules/web/spa",
    );
  });
});
