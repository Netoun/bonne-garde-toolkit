import { useCallback } from "react";
import { useNavigate } from "react-router";
import { OrganizationForm } from "../components/organization-form";
import { useCreateOrganization } from "../hooks/use-organization";

export default function OrganizationNewPage() {
  const navigate = useNavigate();
  const createOrg = useCreateOrganization();

  const handleSubmit = useCallback(
    async (data: { name: string; slug: string; description?: string }) => {
      await createOrg.mutateAsync(data);
      navigate("/organizations");
    },
    [createOrg, navigate],
  );

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">New organization</h1>
        <p className="text-muted-foreground">Create a new organization for your scenarios.</p>
      </div>

      <OrganizationForm onSubmit={handleSubmit} submitLabel="Create organization" />
    </div>
  );
}
