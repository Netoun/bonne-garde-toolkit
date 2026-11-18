import type { Route } from "./+types/organization-members-page";
import { Link } from "react-router";
import { Users, ArrowLeft } from "lucide-react";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { Card, CardContent, CardHeader, CardTitle } from "@acme/ui/components/card";
import { Button } from "@acme/ui/components/button";
import { OrganizationMembersTable } from "../components/organization-members-table";
import { OrganizationInviteMemberDialog } from "../components/organization-invite-member-dialog";
import {
  useOrganization,
  useOrganizationMembers,
  useAddMember,
  useRemoveMember,
} from "../hooks/use-organization";

export default function OrganizationMembers({ params }: Route.ComponentProps) {
  const { organizationSlug } = params;
  const { data: organization, isLoading: orgLoading } = useOrganization(organizationSlug || "");
  const { data: members = [], isLoading: membersLoading } = useOrganizationMembers(
    organization?.id ?? "",
  );
  const addMember = useAddMember();
  const removeMember = useRemoveMember();

  if (orgLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-96 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="max-w-4xl mx-auto text-center py-16">
        <Users className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h2 className="text-xl font-semibold mb-2">Organization not found</h2>
        <Link to="/organizations">
          <Button>Back to organizations</Button>
        </Link>
      </div>
    );
  }

  // Check if current user can manage members (simplified - should use actual auth)
  const canManageMembers = true; // TODO: Check actual user role

  const handleInvite = async (email: string, role: "member" | "admin") => {
    if (!organization?.id) return;
    await addMember.mutateAsync({ orgId: organization.id, data: { email, role } });
  };

  const handleRemove = async (memberId: string) => {
    if (!organization?.id) return;
    await removeMember.mutateAsync({ orgId: organization.id, memberId });
  };

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-4">
        <Link to={`/organizations/${organizationSlug}/settings`}>
          <Button variant="ghost" size="icon">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div>
          <h1 className="text-2xl font-bold">Members of {organization.name}</h1>
          <p className="text-muted-foreground">Manage your organization members</p>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Members ({members.length})</CardTitle>
          {canManageMembers && <OrganizationInviteMemberDialog onInvite={handleInvite} />}
        </CardHeader>
        <CardContent>
          {membersLoading ? (
            <div className="h-40 bg-muted animate-pulse rounded" />
          ) : (
            <OrganizationMembersTable
              members={members}
              currentUserId="" // TODO: Get from auth
              onRemoveMember={handleRemove}
              canRemove={canManageMembers}
            />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
