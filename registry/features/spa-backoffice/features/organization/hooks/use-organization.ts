import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo } from "react";
import { authClient } from "@acme/spa/features/auth/lib/auth";

const QUERY_KEYS = {
  organizations: ["organizations"],
  organization: (slug: string) => ["organization", slug],
  members: (organizationId: string) => ["organization-members", organizationId],
  memberRole: (organizationId: string) => ["organization-member-role", organizationId],
  invitations: (organizationId: string) => ["organization-invitations", organizationId],
};

type OrganizationRole = "owner" | "admin" | "member";

interface OrganizationSettings {
  description?: string;
  primaryColor?: string;
  secondaryColor?: string;
}

interface Organization {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  role: OrganizationRole;
  settings?: OrganizationSettings;
}

interface OrganizationDetail extends Organization {
  scenarios: Array<{
    id: string;
    name: string;
    slug: string;
  }>;
}

interface OrganizationMember {
  memberId: string;
  userId: string;
  role: OrganizationRole;
  createdAt: number;
  name: string;
  email: string;
  image: string | null;
}

interface OrganizationInvitation {
  id: string;
  email: string;
  role: OrganizationRole;
  expiresAt: string;
  status: string;
}

interface OrganizationPermissions {
  canCreateMember: boolean;
  canDeleteMember: boolean;
  canUpdateOrganization: boolean;
  canCancelInvitation: boolean;
}

interface BetterAuthMember {
  id: string;
  userId: string;
  role: string;
  createdAt: Date | string;
  user?: {
    email?: string;
    name?: string | null;
    image?: string | null;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBetterAuthMember(value: unknown): value is BetterAuthMember {
  if (!isRecord(value)) return false;

  const hasBaseFields =
    typeof value.id === "string" &&
    typeof value.userId === "string" &&
    typeof value.role === "string";

  if (!hasBaseFields) return false;

  const createdAtValid = typeof value.createdAt === "string" || value.createdAt instanceof Date;

  if (!createdAtValid) return false;

  if (value.user === undefined || value.user === null) return true;
  if (!isRecord(value.user)) return false;

  const emailValid = value.user.email === undefined || typeof value.user.email === "string";
  const nameValid = value.user.name === undefined || typeof value.user.name === "string";
  const imageValid = value.user.image === undefined || typeof value.user.image === "string";
  return emailValid && nameValid && imageValid;
}

function parseSettings(metadata: unknown): OrganizationSettings {
  if (!isRecord(metadata)) return {};

  return {
    description: typeof metadata.description === "string" ? metadata.description : undefined,
    primaryColor: typeof metadata.primaryColor === "string" ? metadata.primaryColor : undefined,
    secondaryColor:
      typeof metadata.secondaryColor === "string" ? metadata.secondaryColor : undefined,
  };
}

function isRole(value: string): value is OrganizationRole {
  return value === "owner" || value === "admin" || value === "member";
}

function isInvitation(value: unknown): value is {
  id: string;
  email: string;
  role: string;
  expiresAt: string | Date;
  status: string;
} {
  if (!isRecord(value)) return false;
  return (
    typeof value.id === "string" &&
    typeof value.email === "string" &&
    typeof value.role === "string" &&
    typeof value.status === "string" &&
    (typeof value.expiresAt === "string" || value.expiresAt instanceof Date)
  );
}

function permissionsForRole(role: OrganizationRole | undefined): OrganizationPermissions {
  if (!role) {
    return {
      canCreateMember: false,
      canDeleteMember: false,
      canUpdateOrganization: false,
      canCancelInvitation: false,
    };
  }

  return {
    canCreateMember: authClient.organization.checkRolePermission({
      role,
      permissions: { member: ["create"] },
    }),
    canDeleteMember: authClient.organization.checkRolePermission({
      role,
      permissions: { member: ["delete"] },
    }),
    canUpdateOrganization: authClient.organization.checkRolePermission({
      role,
      permissions: { organization: ["update"] },
    }),
    canCancelInvitation: authClient.organization.checkRolePermission({
      role,
      permissions: { invitation: ["cancel"] },
    }),
  };
}

async function fetchOrganizations(): Promise<Organization[]> {
  const response = await authClient.organization.list();
  if (response.error) throw response.error;

  const organizations = response.data ?? [];
  return organizations.map((organization) => ({
    id: organization.id,
    name: organization.name,
    slug: organization.slug,
    logo: organization.logo ?? null,
    role:
      "role" in organization && typeof organization.role === "string" && isRole(organization.role)
        ? organization.role
        : "member",
    settings: parseSettings(organization.metadata),
  }));
}

export function useOrganizations(options?: { enabled?: boolean }) {
  return useQuery({
    queryKey: QUERY_KEYS.organizations,
    queryFn: fetchOrganizations,
    enabled: options?.enabled ?? true,
  });
}

export function useCreateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (input: { name: string; slug: string; description?: string }) => {
      const metadata = input.description ? { description: input.description } : undefined;
      const response = await authClient.organization.create({
        name: input.name,
        slug: input.slug,
        metadata,
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.organizations });
    },
  });
}

async function fetchOrganization(slug: string): Promise<OrganizationDetail | null> {
  const organizations = await fetchOrganizations();
  const organization = organizations.find((entry) => entry.slug === slug);
  if (!organization) return null;

  return {
    ...organization,
    scenarios: [],
  };
}

export function useOrganization(slug: string) {
  return useQuery({
    queryKey: QUERY_KEYS.organization(slug),
    queryFn: () => fetchOrganization(slug),
    enabled: !!slug,
  });
}

export function useUpdateOrganization() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: {
        name?: string;
        slug?: string;
        logo?: string;
        description?: string;
        primaryColor?: string;
        secondaryColor?: string;
      };
    }) => {
      const metadata: OrganizationSettings = {};
      if (data.description !== undefined) metadata.description = data.description;
      if (data.primaryColor !== undefined) metadata.primaryColor = data.primaryColor;
      if (data.secondaryColor !== undefined) metadata.secondaryColor = data.secondaryColor;

      const response = await authClient.organization.update({
        organizationId: id,
        data: {
          name: data.name,
          slug: data.slug,
          logo: data.logo,
          metadata,
        },
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: QUERY_KEYS.organizations });
      queryClient.invalidateQueries({ queryKey: ["organization"] });
    },
  });
}

async function fetchMembers(organizationId: string): Promise<OrganizationMember[]> {
  const response = await authClient.organization.listMembers({
    query: { organizationId },
  });
  if (response.error) throw response.error;

  const members = (response.data?.members ?? []).filter(isBetterAuthMember);

  return members.map((member) => ({
    memberId: member.id,
    userId: member.userId,
    role: isRole(member.role) ? member.role : "member",
    createdAt: new Date(member.createdAt).getTime(),
    name: member.user?.name ?? member.user?.email ?? "Unknown",
    email: member.user?.email ?? "",
    image: member.user?.image ?? null,
  }));
}

export function useOrganizationMembers(organizationId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.members(organizationId),
    queryFn: () => fetchMembers(organizationId),
    enabled: !!organizationId,
  });
}

export function useAddMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId,
      data,
    }: {
      orgId: string;
      data: { email: string; role?: "member" | "admin" };
    }) => {
      const response = await authClient.organization.inviteMember({
        organizationId: orgId,
        email: data.email,
        role: data.role ?? "member",
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.members(variables.orgId),
      });
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.invitations(variables.orgId),
      });
    },
  });
}

export function useRemoveMember() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ orgId, memberId }: { orgId: string; memberId: string }) => {
      const response = await authClient.organization.removeMember({
        organizationId: orgId,
        memberIdOrEmail: memberId,
      });

      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.members(variables.orgId),
      });
    },
  });
}

async function fetchMemberRole(organizationId: string): Promise<OrganizationRole> {
  const response = await authClient.organization.getActiveMemberRole({
    query: { organizationId },
  });
  if (response.error) throw response.error;
  const role = response.data?.role;
  if (typeof role !== "string" || !isRole(role)) {
    throw new Error("Could not resolve organization role");
  }
  return role;
}

export function useOrganizationMemberRole(organizationId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.memberRole(organizationId),
    queryFn: () => fetchMemberRole(organizationId),
    enabled: !!organizationId,
  });
}

export function useOrganizationPermissions(organizationId: string) {
  const { data: role, isLoading, isError } = useOrganizationMemberRole(organizationId);
  const permissions = useMemo(() => permissionsForRole(role), [role]);
  return { role, permissions, isLoading, isError };
}

async function fetchInvitations(organizationId: string): Promise<OrganizationInvitation[]> {
  const response = await authClient.organization.listInvitations({
    query: { organizationId },
  });
  if (response.error) throw response.error;

  const rows = Array.isArray(response.data) ? response.data : [];
  return rows.filter(isInvitation).flatMap((row) => {
    if (row.status !== "pending") return [];
    return [
      {
        id: row.id,
        email: row.email,
        role: isRole(row.role) ? row.role : "member",
        expiresAt: new Date(row.expiresAt).toISOString(),
        status: row.status,
      },
    ];
  });
}

export function useOrganizationInvitations(organizationId: string) {
  return useQuery({
    queryKey: QUERY_KEYS.invitations(organizationId),
    queryFn: () => fetchInvitations(organizationId),
    enabled: !!organizationId,
  });
}

export function useCancelInvitation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      orgId: _orgId,
      invitationId,
    }: {
      orgId: string;
      invitationId: string;
    }) => {
      const response = await authClient.organization.cancelInvitation({
        invitationId,
      });
      if (response.error) throw response.error;
      return response.data;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({
        queryKey: QUERY_KEYS.invitations(variables.orgId),
      });
    },
  });
}

export type {
  Organization,
  OrganizationDetail,
  OrganizationInvitation,
  OrganizationMember,
  OrganizationPermissions,
  OrganizationRole,
};
