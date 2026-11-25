import { screen, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { organizationAuthHandlers, server } from "../lib/organization-msw-handlers";
import { renderWithProviders } from "../lib/render-with-providers";
import type { Route } from "./+types/organization-settings-page";
import OrganizationSettings from "./organization-settings-page";

describe("OrganizationSettings", () => {
  const routeProps = {
    params: { organizationSlug: "acme" },
    matches: [],
  } as unknown as Route.ComponentProps;

  it("keeps the settings form read-only for a member and editable for an admin", async () => {
    server.use(...organizationAuthHandlers({ role: "member" }));
    const { unmount } = renderWithProviders(<OrganizationSettings {...routeProps} />);

    const nameInputMember = await screen.findByLabelText(/nom/i);
    await waitFor(() => {
      expect(nameInputMember).toBeDisabled();
    });
    expect(screen.queryByRole("button", { name: /save changes/i })).not.toBeInTheDocument();
    unmount();

    server.use(...organizationAuthHandlers({ role: "admin" }));
    renderWithProviders(<OrganizationSettings {...routeProps} />);

    const nameInputAdmin = await screen.findByLabelText(/nom/i);
    await waitFor(() => {
      expect(nameInputAdmin).not.toBeDisabled();
    });
    expect(screen.getByRole("button", { name: /save changes/i })).toBeInTheDocument();
  });
});
