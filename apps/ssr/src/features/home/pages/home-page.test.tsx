import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { branding } from "@acme/config";
import HomePage from "./home-page";

it("renders the product identity and availability message", () => {
  render(<HomePage />);
  expect(screen.getByRole("heading", { name: branding.displayName })).toBeInTheDocument();
  expect(screen.getByText("Bientôt disponible")).toBeInTheDocument();
});
