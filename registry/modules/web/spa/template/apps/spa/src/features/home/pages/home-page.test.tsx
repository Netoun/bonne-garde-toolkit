import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { branding } from "{{SCOPE}}/config";
import HomePage from "./home-page";

it("renders the product name as the page heading", () => {
  render(<HomePage />);
  expect(screen.getByRole("heading", { name: branding.displayName })).toBeInTheDocument();
});
