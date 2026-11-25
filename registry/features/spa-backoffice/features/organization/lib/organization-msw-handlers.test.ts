import { describe } from "vite-plus/test";
import { http, HttpResponse } from "msw";

describe.skip("organization MSW helpers", () => {});

export { server } from "./organization-msw-server.test";

type OrganizationRole = "owner" | "admin" | "member";

function isAuthPath(url: string, suffix: string) {
  return new URL(url).pathname.endsWith(`/api/auth${suffix}`);
}

const ORG = {
  id: "org-1",
  name: "Acme",
  slug: "acme",
  logo: null,
  metadata: { description: "Test org" },
  createdAt: new Date().toISOString(),
};

const SESSION_USER = {
  id: "user-current",
  email: "owner@example.com",
  name: "Current User",
  emailVerified: true,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  image: null,
};

interface InvitationRow {
  id: string;
  email: string;
  role: OrganizationRole;
  status: "pending";
  expiresAt: string;
  organizationId: string;
}

interface OrganizationHandlerOptions {
  role: OrganizationRole;
  invitations?: InvitationRow[];
  onCancelInvitation?: (invitationId: string) => void;
}

export function organizationAuthHandlers(options: OrganizationHandlerOptions) {
  let invitations = options.invitations ?? [];

  const members = [
    {
      id: "member-current",
      userId: SESSION_USER.id,
      role: options.role,
      createdAt: new Date().toISOString(),
      user: {
        email: SESSION_USER.email,
        name: SESSION_USER.name,
      },
    },
    {
      id: "member-other",
      userId: "user-other",
      role: "member" as const,
      createdAt: new Date().toISOString(),
      user: {
        email: "other@example.com",
        name: "Other User",
      },
    },
  ];

  return [
    http.all(/.*/, async ({ request }) => {
      if (!request.url.includes("/api/auth")) {
        return;
      }
      if (request.method === "GET" && isAuthPath(request.url, "/get-session")) {
        return HttpResponse.json({
          session: {
            id: "session-1",
            userId: SESSION_USER.id,
            token: "token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            activeOrganizationId: ORG.id,
          },
          user: SESSION_USER,
        });
      }
      if (request.method === "GET" && isAuthPath(request.url, "/organization/list-members")) {
        return HttpResponse.json({ members, total: members.length });
      }
      if (request.method === "GET" && isAuthPath(request.url, "/organization/list")) {
        return HttpResponse.json([ORG]);
      }
      if (
        request.method === "GET" &&
        isAuthPath(request.url, "/organization/get-active-member-role")
      ) {
        return HttpResponse.json({ role: options.role });
      }
      if (request.method === "GET" && isAuthPath(request.url, "/organization/list-invitations")) {
        return HttpResponse.json(invitations);
      }
      if (request.method === "POST" && isAuthPath(request.url, "/organization/cancel-invitation")) {
        const body = (await request.json()) as { invitationId: string };
        invitations = invitations.filter((row) => row.id !== body.invitationId);
        options.onCancelInvitation?.(body.invitationId);
        return HttpResponse.json({ id: body.invitationId, status: "canceled" });
      }
      return;
    }),
  ];
}

export function pendingInvitation(overrides?: Partial<InvitationRow>): InvitationRow {
  return {
    id: "inv-1",
    email: "invitee@example.com",
    role: "member",
    status: "pending",
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    organizationId: ORG.id,
    ...overrides,
  };
}

const INVITER = {
  id: "user-inviter",
  email: "owner@example.com",
  name: "Org Owner",
};

interface InvitationPageHandlerOptions {
  signedIn?: boolean;
  sessionEmail?: string;
  invitation?: InvitationRow;
  getInvitationMode?: "ok" | "not-found" | "wrong-email";
  memberOfInvitedOrganization?: boolean;
  acceptInvitationMode?: "ok" | "error";
  acceptInvitationErrorMessage?: string;
  onAcceptInvitation?: (invitationId: string) => void;
  onRejectInvitation?: (invitationId: string) => void;
}

export function organizationInvitationHandlers(options: InvitationPageHandlerOptions) {
  const invitation =
    options.invitation ??
    pendingInvitation({ email: options.sessionEmail ?? "invitee@example.com" });
  const sessionEmail = options.sessionEmail ?? invitation.email;
  const sessionUser = {
    id: "user-invitee",
    email: sessionEmail,
    name: "Invitee User",
    emailVerified: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    image: null,
  };

  return [
    http.all(/.*/, async ({ request }) => {
      if (!request.url.includes("/api/auth")) {
        return;
      }

      if (request.method === "GET" && isAuthPath(request.url, "/get-session")) {
        if (options.signedIn === false) {
          return HttpResponse.json(null);
        }
        return HttpResponse.json({
          session: {
            id: "session-invitee",
            userId: sessionUser.id,
            token: "token",
            expiresAt: new Date(Date.now() + 60_000).toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            activeOrganizationId: ORG.id,
          },
          user: sessionUser,
        });
      }

      if (request.method === "GET" && isAuthPath(request.url, "/organization/get-invitation")) {
        const id = new URL(request.url).searchParams.get("id");
        if (options.getInvitationMode === "not-found" || id !== invitation.id) {
          return HttpResponse.json(
            { message: "Invitation not found!", code: "INVITATION_NOT_FOUND" },
            { status: 400 },
          );
        }
        if (
          options.getInvitationMode === "wrong-email" ||
          sessionEmail.toLowerCase() !== invitation.email.toLowerCase()
        ) {
          return HttpResponse.json(
            {
              message: "You are not the recipient of the invitation",
              code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
            },
            { status: 403 },
          );
        }
        return HttpResponse.json({
          ...invitation,
          organizationName: ORG.name,
          organizationSlug: ORG.slug,
          inviterId: INVITER.id,
          inviterEmail: INVITER.email,
        });
      }

      if (request.method === "GET" && isAuthPath(request.url, "/organization/list")) {
        if (options.memberOfInvitedOrganization) {
          return HttpResponse.json([{ ...ORG, role: "member" }]);
        }
        return HttpResponse.json([]);
      }

      if (request.method === "POST" && isAuthPath(request.url, "/organization/accept-invitation")) {
        const body = (await request.json()) as { invitationId: string };
        if (options.acceptInvitationMode === "error") {
          return HttpResponse.json(
            {
              message: options.acceptInvitationErrorMessage ?? "Invitation not found!",
              code: "INVITATION_NOT_FOUND",
            },
            { status: 400 },
          );
        }
        options.onAcceptInvitation?.(body.invitationId);
        return HttpResponse.json({
          invitation: { ...invitation, status: "accepted" },
          member: {
            id: "member-new",
            userId: sessionUser.id,
            organizationId: ORG.id,
            role: invitation.role,
          },
        });
      }

      if (request.method === "POST" && isAuthPath(request.url, "/organization/reject-invitation")) {
        const body = (await request.json()) as { invitationId: string };
        options.onRejectInvitation?.(body.invitationId);
        return HttpResponse.json({
          invitation: { ...invitation, status: "rejected" },
          member: null,
        });
      }

      if (request.method === "POST" && isAuthPath(request.url, "/organization/set-active")) {
        return HttpResponse.json({ success: true });
      }

      if (request.method === "POST" && isAuthPath(request.url, "/sign-out")) {
        return HttpResponse.json({ success: true });
      }

      return;
    }),
  ];
}
