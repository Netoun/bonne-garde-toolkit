import { render, screen } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { branding } from "@acme/config";
import { LayoutFooter } from "./layout-footer";

it("renders product branding and the current legal notice", () => {
  render(<LayoutFooter />);
  expect(screen.getByRole("contentinfo")).toHaveTextContent(branding.displayName);
  expect(screen.getByRole("contentinfo")).toHaveTextContent(
    `© ${new Date().getFullYear()} ${branding.legalName}`,
  );
});
