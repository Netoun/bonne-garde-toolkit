import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { branding } from "{{SCOPE}}/config";
import Home from "./home";

it("renders the product name as the page heading", () => {
  render(<Home />);
  expect(screen.getByRole("heading", { name: branding.displayName })).toBeInTheDocument();
});
