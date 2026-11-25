import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import { authClient } from "@acme/spa/features/auth/lib/auth";
import {
  organizationInvitationHandlers,
  pendingInvitation,
  server,
} from "../lib/organization-msw-handlers.test";
import { renderWithProviders } from "../lib/render-with-providers.test";
import type { Route as InvitationRoute } from "./+types/organization-invitation-page";
import OrganizationInvitationPage from "./organization-invitation-page";

function LocationProbe() {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
}

describe("OrganizationInvitationPage", () => {
  afterEach(async () => {
    server.use(...organizationInvitationHandlers({ sessionEmail: "reset@example.com" }));
    await authClient.signOut();
  });

  const routeProps = {
    params: { invitationId: "inv-1" },
    matches: [],
  } as unknown as InvitationRoute.ComponentProps;

  function renderInvitationPage(initialEntries = ["/invitations/inv-1"]) {
    return renderWithProviders(
      <>
        <LocationProbe />
        <Routes>
          <Route
            path="/invitations/:invitationId"
            element={<OrganizationInvitationPage {...routeProps} />}
          />
          <Route path="/organizations/:organizationSlug/members" element={<div>Members</div>} />
          <Route path="/dashboard" element={<div>Dashboard</div>} />
          <Route path="/auth/login" element={<div>Login</div>} />
        </Routes>
      </>,
      { initialEntries },
    );
  }

  it("accepts a pending invitation and navigates to the organization members page", async () => {
    const onAccept = vi.fn();
    server.use(
      ...organizationInvitationHandlers({
        sessionEmail: "invitee@example.com",
        invitation: pendingInvitation(),
        onAcceptInvitation: onAccept,
      }),
    );

    const user = userEvent.setup();
    renderInvitationPage();

    expect(await screen.findByText(/Acme/i)).toBeInTheDocument();
    expect(screen.getByText(/owner@example.com/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /accept/i }));

    await waitFor(() => {
      expect(onAccept).toHaveBeenCalledWith("inv-1");
    });
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent("/organizations/acme/members");
    });
  });

  it("rejects a pending invitation", async () => {
    const onReject = vi.fn();
    server.use(
      ...organizationInvitationHandlers({
        sessionEmail: "invitee@example.com",
        onRejectInvitation: onReject,
      }),
    );

    const user = userEvent.setup();
    renderInvitationPage();

    await screen.findByRole("button", { name: /decline/i });
    await user.click(screen.getByRole("button", { name: /decline/i }));

    await waitFor(() => {
      expect(onReject).toHaveBeenCalledWith("inv-1");
    });
  });

  it("shows an expired or missing invitation message", async () => {
    server.use(
      ...organizationInvitationHandlers({
        sessionEmail: "invitee@example.com",
        getInvitationMode: "not-found",
      }),
    );

    renderInvitationPage();

    expect(
      await screen.findByText(/this invitation has expired or could not be found/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/already a member/i)).not.toBeInTheDocument();
  });

  it("shows already a member when the invitee belongs to the organization", async () => {
    server.use(
      ...organizationInvitationHandlers({
        sessionEmail: "invitee@example.com",
        memberOfInvitedOrganization: true,
      }),
    );

    renderInvitationPage();

    expect(await screen.findByText("Already a member")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /view organization/i })).toHaveAttribute(
      "href",
      "/organizations/acme/members",
    );
  });

  it("shows an error when accepting fails", async () => {
    server.use(
      ...organizationInvitationHandlers({
        sessionEmail: "invitee@example.com",
        acceptInvitationMode: "error",
        acceptInvitationErrorMessage: "Invitation not found!",
      }),
    );

    const user = userEvent.setup();
    renderInvitationPage();

    await user.click(await screen.findByRole("button", { name: /accept/i }));

    expect(await screen.findByText("Invitation not found!")).toBeInTheDocument();
    expect(screen.getByTestId("location")).toHaveTextContent("/invitations/inv-1");
  });

  it("shows the signed-in email when the invitation belongs to another account", async () => {
    server.use(
      ...organizationInvitationHandlers({
        sessionEmail: "wrong@example.com",
        invitation: pendingInvitation({ email: "invitee@example.com" }),
        getInvitationMode: "wrong-email",
      }),
    );

    renderInvitationPage();

    expect(await screen.findByText("Wrong account")).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText("wrong@example.com")).toBeInTheDocument();
    });
  });

  it("redirects signed-out visitors to login with a return path", async () => {
    server.use(
      ...organizationInvitationHandlers({
        signedIn: false,
      }),
    );

    renderInvitationPage();

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/auth/login?redirect=%2Finvitations%2Finv-1",
      );
    });
  });
});
