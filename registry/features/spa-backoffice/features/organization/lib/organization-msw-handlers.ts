import { http, HttpResponse } from "msw";

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
