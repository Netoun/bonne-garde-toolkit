import { useCallback, useState, type ReactNode } from "react";
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

function formatMutationError(error: unknown): string {
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  return "Something went wrong. Please try again.";
}

export default function OrganizationInvitationPage({ params }: Route.ComponentProps) {
  useAuthRedirect();
  const navigate = useNavigate();
  const { data: sessionData, isPending: sessionPending } = useSession();
  const invitationId = params.invitationId;
  const { data: invitation, error, isPending, isError } = useOrganizationInvitation(invitationId);
  const { data: organizations, isPending: organizationsPending } = useOrganizations({
    enabled: !!sessionData,
  });
  const acceptInvitation = useAcceptOrganizationInvitation();
  const rejectInvitation = useRejectOrganizationInvitation();
  const [actionError, setActionError] = useState<string | null>(null);

  const loadErrorKind = isError ? classifyInvitationLoadError(error) : null;

  const memberOfInvitedOrganization =
    invitation && organizations
      ? organizations.find((org) => org.id === invitation.organizationId)
      : undefined;

  const handleAccept = useCallback(async () => {
    if (!invitation) return;
    setActionError(null);
    try {
      const result = await acceptInvitation.mutateAsync({
        invitationId: invitation.id,
        organizationId: invitation.organizationId,
        organizationSlug: invitation.organizationSlug,
      });
      navigate(`/organizations/${result.organizationSlug}/members`);
    } catch (mutationError) {
      setActionError(formatMutationError(mutationError));
    }
  }, [acceptInvitation, invitation, navigate]);

  const handleDecline = useCallback(async () => {
    setActionError(null);
    try {
      await rejectInvitation.mutateAsync(invitationId);
      navigate("/dashboard");
    } catch (mutationError) {
      setActionError(formatMutationError(mutationError));
    }
  }, [invitationId, navigate, rejectInvitation]);

  if (sessionPending || (sessionData && (isPending || organizationsPending))) {
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
          </CardContent>
          <CardFooter className="flex flex-col gap-2">
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

  if (memberOfInvitedOrganization) {
    return (
      <InvitationPageShell>
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Already a member</CardTitle>
          </CardHeader>
          <CardContent className="text-sm text-muted-foreground space-y-2">
            <p>
              You are already a member of{" "}
              <span className="font-medium text-foreground">
                {memberOfInvitedOrganization.name}
              </span>
              .
            </p>
          </CardContent>
          <CardFooter>
            <Button asChild className="w-full">
              <Link to={`/organizations/${memberOfInvitedOrganization.slug}/members`}>
                View organization
              </Link>
            </Button>
          </CardFooter>
        </Card>
      </InvitationPageShell>
    );
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
          {actionError ? <p className="text-destructive">{actionError}</p> : null}
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
