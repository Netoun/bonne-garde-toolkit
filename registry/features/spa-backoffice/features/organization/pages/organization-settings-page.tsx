import type { Route } from "./+types/organization-settings-page";
import { useState } from "react";
import { Link } from "react-router";
import { Building2, Upload } from "lucide-react";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { Card, CardContent, CardHeader, CardTitle } from "@acme/ui/components/card";
import { Button } from "@acme/ui/components/button";
import { Input } from "@acme/ui/components/input";
import { Label } from "@acme/ui/components/label";
// oxfmt-ignore
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@acme/ui/components/tabs";
import { api } from "@acme/spa/lib/api";
import { useSession } from "@acme/spa/features/auth/hooks/use-session";
import { OrganizationForm } from "../components/organization-form";
import { OrganizationMembersTable } from "../components/organization-members-table";
import { OrganizationInviteMemberDialog } from "../components/organization-invite-member-dialog";
import {
  useOrganization,
  useOrganizationMembers,
  useOrganizationPermissions,
  useUpdateOrganization,
  useAddMember,
  useRemoveMember,
} from "../hooks/use-organization";

export default function OrganizationSettings({ params }: Route.ComponentProps) {
  const { organizationSlug } = params;
  const { data: organization, isLoading } = useOrganization(organizationSlug || "");
  const { data: members = [], isLoading: membersLoading } = useOrganizationMembers(
    organization?.id ?? "",
  );
  const updateOrg = useUpdateOrganization();
  const addMember = useAddMember();
  const removeMember = useRemoveMember();
  const [uploadError, setUploadError] = useState<string | null>(null);
  const { data: session } = useSession();
  const currentUserId = session?.user.id ?? "";
  const organizationId = organization?.id ?? "";
  const { permissions, isLoading: permissionsLoading } = useOrganizationPermissions(organizationId);

  if (isLoading || permissionsLoading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <div className="h-8 w-48 bg-muted animate-pulse rounded" />
        <div className="h-96 bg-muted animate-pulse rounded" />
      </div>
    );
  }

  if (!organization) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="text-center py-16">
          <Building2 className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
          <h2 className="text-xl font-semibold mb-2">Organization not found</h2>
          <p className="text-muted-foreground mb-4">
            The organization you are looking for does not exist or you don&apos;t have access.
          </p>
          <Link to="/organizations">
            <Button>Back to organizations</Button>
          </Link>
        </div>
      </div>
    );
  }

  const handleLogoUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file || !organization?.id) return;

    setUploadError(null);

    const { data, error } = await api.v1.media.post({ file, organizationId: organization.id });

    if (error) {
      const value = error.value;
      const message =
        value !== null &&
        typeof value === "object" &&
        "error" in value &&
        typeof value.error === "string"
          ? value.error
          : "Upload failed";
      setUploadError(message);
      return;
    }

    await updateOrg.mutateAsync({ id: organization.id, data: { logo: data.url } });
  };

  const handleInvite = async (email: string, role: "member" | "admin") => {
    if (!organization?.id) return;
    await addMember.mutateAsync({ orgId: organization.id, data: { email, role } });
  };

  const handleUpdate = async (data: {
    name?: string;
    slug?: string;
    logo?: string;
    description?: string;
    primaryColor?: string;
    secondaryColor?: string;
  }) => {
    if (!organization?.id) return;
    await updateOrg.mutateAsync({ id: organization.id, data });
  };

  const handleRemoveMember = async (memberId: string) => {
    if (!organization?.id) return;
    await removeMember.mutateAsync({ orgId: organization.id, memberId });
  };

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">{organization.name}</h1>
        <p className="text-muted-foreground">@{organization.slug}</p>
      </div>

      <Tabs defaultValue="general" className="w-full space-y-4">
        <TabsList>
          <TabsTrigger value="general">General</TabsTrigger>
          <TabsTrigger value="members">Members</TabsTrigger>
          <TabsTrigger value="appearance">Appearance</TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="space-y-4">
          <OrganizationForm
            initialData={{
              name: organization.name,
              slug: organization.slug,
              description: organization.settings?.description ?? undefined,
            }}
            onSubmit={handleUpdate}
            submitLabel="Save changes"
            isEdit
            readOnly={!permissions.canUpdateOrganization}
          />
        </TabsContent>

        <TabsContent value="members" className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>Members ({members.length})</CardTitle>
              {permissions.canCreateMember ? (
                <OrganizationInviteMemberDialog onInvite={handleInvite} />
              ) : null}
            </CardHeader>
            <CardContent>
              {membersLoading ? (
                <div className="h-40 bg-muted animate-pulse rounded" />
              ) : (
                <OrganizationMembersTable
                  members={members}
                  currentUserId={currentUserId}
                  onRemoveMember={handleRemoveMember}
                  canRemove={permissions.canDeleteMember}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="appearance" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Logo</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-4">
                {organization.logo ? (
                  <img
                    src={organization.logo}
                    alt={organization.name}
                    className="h-20 w-20 rounded-lg object-cover border"
                  />
                ) : (
                  <div className="h-20 w-20 rounded-lg bg-muted flex items-center justify-center border">
                    <Building2 className="h-8 w-8 text-muted-foreground" />
                  </div>
                )}
                <div>
                  <Label htmlFor="logo" className="cursor-pointer">
                    <div className="inline-flex">
                      <Button variant="outline">
                        <Upload className="h-4 w-4 mr-2" />
                        Change logo
                      </Button>
                    </div>
                  </Label>
                  <Input
                    id="logo"
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={handleLogoUpload}
                  />
                  <p className="text-xs text-muted-foreground mt-2">
                    Recommended format: 200x200px, JPG or PNG
                  </p>
                  {uploadError && (
                    <div className="p-3 text-sm text-destructive bg-destructive/10 rounded-md mt-2">
                      {uploadError}
                    </div>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>

          <OrganizationForm
            initialData={{
              name: organization.name,
              slug: organization.slug,
              description: organization.settings?.description ?? undefined,
              primaryColor: organization.settings?.primaryColor ?? "#3b82f6",
              secondaryColor: organization.settings?.secondaryColor ?? "#8b5cf6",
            }}
            onSubmit={handleUpdate}
            submitLabel="Save changes"
            isEdit
            readOnly={!permissions.canUpdateOrganization}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
