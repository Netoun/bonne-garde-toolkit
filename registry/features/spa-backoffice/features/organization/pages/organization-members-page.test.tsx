import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vite-plus/test";
import { server } from "@acme/spa/testing/server";
import { organizationAuthHandlers, pendingInvitation } from "../lib/organization-msw-handlers";
import { renderWithProviders } from "../lib/render-with-providers";
import type { Route } from "./+types/organization-members-page";
import OrganizationMembers from "./organization-members-page";

describe("OrganizationMembers", () => {
  const routeProps = {
    params: { organizationSlug: "acme" },
    matches: [],
  } as unknown as Route.ComponentProps;

  it("hides invite and remove actions for a member", async () => {
    server.use(...organizationAuthHandlers({ role: "member" }));
    renderWithProviders(<OrganizationMembers {...routeProps} />);

    await waitFor(() => {
      expect(screen.getByText(/Members of Acme/i)).toBeInTheDocument();
    });
    expect(screen.queryByRole("button", { name: /invite a member/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /remove/i })).not.toBeInTheDocument();
  });

  it("shows invite and remove actions for an owner", async () => {
    server.use(...organizationAuthHandlers({ role: "owner" }));
    renderWithProviders(<OrganizationMembers {...routeProps} />);

    await waitFor(() => {
      expect(screen.getByText("Other User")).toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: /invite a member/i }).length).toBeGreaterThan(0);
    expect(screen.getByRole("button", { name: /remove member other user/i })).toBeInTheDocument();
  });

  it("lists pending invitations and removes a row after cancel", async () => {
    const onCancel = vi.fn();
    server.use(
      ...organizationAuthHandlers({
        role: "owner",
        invitations: [pendingInvitation()],
        onCancelInvitation: onCancel,
      }),
    );

    const user = userEvent.setup();
    renderWithProviders(<OrganizationMembers {...routeProps} />);

    expect(await screen.findByText("invitee@example.com")).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: /cancel invitation for invitee@example.com/i }),
    );

    await waitFor(() => {
      expect(onCancel).toHaveBeenCalledWith("inv-1");
    });
    await waitFor(() => {
      expect(screen.queryByText("invitee@example.com")).not.toBeInTheDocument();
    });
  });
});
