import { useCallback, type ReactNode } from "react";
import { Link, useNavigate } from "react-router";
import { Building2, Mail } from "lucide-react";
// oxfmt-ignore
import { Badge } from "@acme/ui/components/badge";
import { Button } from "@acme/ui/components/button";
// oxfmt-ignore
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@acme/ui/components/card";
import { useAuthRedirect } from "@acme/spa/features/auth/hooks/use-auth-redirect";
import { useSession } from "@acme/spa/features/auth/hooks/use-session";
import {
  classifyInvitationLoadError,
  useAcceptOrganizationInvitation,
  useOrganizationInvitation,
  useOrganizations,
  useRejectOrganizationInvitation,
} from "../hooks/use-organization";
import type { Route } from "./+types/organization-invitation-page";

const roleLabel: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

export default function OrganizationInvitationPage({ params }: Route.ComponentProps) {
  useAuthRedirect();
  const navigate = useNavigate();
  const { data: sessionData, isPending: sessionPending } = useSession();
  const invitationId = params.invitationId;
  const { data: invitation, error, isPending, isError } = useOrganizationInvitation(invitationId);
  const { data: organizations } = useOrganizations({ enabled: !!sessionData });
  const acceptInvitation = useAcceptOrganizationInvitation();
  const rejectInvitation = useRejectOrganizationInvitation();

  const loadErrorKind = isError ? classifyInvitationLoadError(error) : null;

  const alreadyMemberOrganization =
    loadErrorKind === "not-found" && organizations
      ? organizations.find((org) => org.id === sessionData?.session?.activeOrganizationId)
      : undefined;

  const handleAccept = useCallback(async () => {
    if (!invitation) return;
    const result = await acceptInvitation.mutateAsync({
      invitationId: invitation.id,
      organizationId: invitation.organizationId,
      organizationSlug: invitation.organizationSlug,
    });
    navigate(`/organizations/${result.organizationSlug}/members`);
  }, [acceptInvitation, invitation, navigate]);

  const handleDecline = useCallback(async () => {
    await rejectInvitation.mutateAsync(invitationId);
    navigate("/dashboard");
  }, [invitationId, navigate, rejectInvitation]);

  if (sessionPending || (sessionData && isPending)) {
    return (
      <InvitationPageShell>
        <p className="text-muted-foreground text-sm">Loading invitation...</p>
      </InvitationPageShell>
    );
  }

  if (!sessionData) {
    return null;
  }

  if (loadErrorKind === "wrong-recipient") {
    return (
      <InvitationPageShell>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Wrong account</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>This invitation was sent to a different email address.</p>
            <p>
              You are signed in as{" "}
              <span className="font-medium text-foreground">{sessionData.user.email}</span>.
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild variant="outline" className="w-full">
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          </CardFooter>
        </Card>
      </InvitationPageShell>
    );
  }

  if (loadErrorKind === "not-found") {
    return (
      <InvitationPageShell>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Invitation unavailable</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-3">
            <p>This invitation has expired or could not be found.</p>
            {alreadyMemberOrganization ? (
              <p>
                You are already a member of{" "}
                <span className="font-medium text-foreground">
                  {alreadyMemberOrganization.name}
                </span>
                .
              </p>
            ) : null}
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
            {alreadyMemberOrganization ? (
              <Button asChild className="w-full">
                <Link to={`/organizations/${alreadyMemberOrganization.slug}/members`}>
                  View organization
                </Link>
              </Button>
            ) : null}
            <Button asChild variant="outline" className="w-full">
              <Link to="/dashboard">Go to dashboard</Link>
            </Button>
          </CardFooter>
        </Card>
      </InvitationPageShell>
    );
  }

  if (!invitation) {
    return null;
  }

  return (
    <InvitationPageShell>
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary/10">
              <Building2 className="h-5 w-5 text-primary" />
            </div>
            <div>
              <CardTitle>Join {invitation.organizationName}</CardTitle>
              <p className="text-sm text-muted-foreground">Organization invitation</p>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <InvitationDetailRow
            icon={<Mail className="h-4 w-4 text-muted-foreground" />}
            label="Invited by"
            value={invitation.inviterEmail}
          />
          <div className="flex items-center justify-between gap-4">
            <span className="text-muted-foreground">Role</span>
            <Badge variant="secondary">{roleLabel[invitation.role] ?? invitation.role}</Badge>
          </div>
          <p className="text-muted-foreground">
            Accept to join as <span className="text-foreground">{sessionData.user.email}</span>.
          </p>
        </CardContent>
        <CardFooter className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="flex-1"
            disabled={rejectInvitation.isPending || acceptInvitation.isPending}
            onClick={() => void handleDecline()}
          >
            Decline
          </Button>
          <Button
            type="button"
            className="flex-1"
            disabled={acceptInvitation.isPending || rejectInvitation.isPending}
            onClick={() => void handleAccept()}
          >
            Accept
          </Button>
        </CardFooter>
      </Card>
    </InvitationPageShell>
  );
}

function InvitationPageShell({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm">{children}</div>
    </div>
  );
}

function InvitationDetailRow({
  icon,
  label,
  value,
}: {
  icon: ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4">
      <span className="flex items-center gap-2 text-muted-foreground">
        {icon}
        {label}
      </span>
      <span className="font-medium text-foreground text-right">{value}</span>
    </div>
  );
}
