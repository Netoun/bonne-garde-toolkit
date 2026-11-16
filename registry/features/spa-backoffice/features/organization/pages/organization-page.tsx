import { Link } from "react-router";
import { Plus, Building2 } from "lucide-react";
import { Button } from "@acme/ui/components/button";
import { OrganizationCard } from "../components/organization-card";
import { useOrganizations } from "../hooks/use-organization";
import { OrganizationHeader } from "../components/organization-header";

export const handle = {
  header: OrganizationHeader,
};

export default function Organizations() {
  const { data: organizations, isLoading, error } = useOrganizations();

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-40 rounded-lg border bg-muted animate-pulse" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-4 border border-destructive/20 bg-destructive/10 rounded-lg text-destructive">
        Error loading organizations: {error.message}
      </div>
    );
  }

  const orgs = organizations ?? [];

  return (
    <div className="space-y-4">
      {orgs.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 text-center rounded-xl border border-dashed border-border bg-muted/30">
          <div className="h-14 w-14 rounded-xl bg-primary/8 ring-1 ring-primary/15 flex items-center justify-center mb-4">
            <Building2 className="h-7 w-7 text-primary/70" />
          </div>
          <h3 className="text-base font-semibold mb-1">No organizations</h3>
          <p className="text-sm text-muted-foreground max-w-xs mb-5">
            Create your first organization to start building scenarios and games.
          </p>
          <Link to="/organizations/new">
            <Button size="sm">
              <Plus className="h-4 w-4 mr-2" />
              Create an organization
            </Button>
          </Link>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orgs.map((org) => (
            <OrganizationCard key={org.id} organization={org} />
          ))}
        </div>
      )}
    </div>
  );
}
