import { Link } from "react-router";
import { Building2, Settings, Users } from "lucide-react";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { Card, CardContent, CardHeader, CardTitle } from "@acme/ui/components/card";
import { Badge } from "@acme/ui/components/badge";
import { Button } from "@acme/ui/components/button";
import type { Organization } from "../hooks/use-organization";

interface OrganizationCardProps {
  organization: Organization;
}

export function OrganizationCard({ organization }: OrganizationCardProps) {
  const roleLabel: Record<string, string> = {
    owner: "Owner",
    admin: "Admin",
    member: "Member",
  };

  const roleVariant: Record<string, "default" | "secondary" | "outline"> = {
    owner: "default",
    admin: "secondary",
    member: "outline",
  };

  return (
    <Card className="hover:shadow-md transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
              {organization.logo ? (
                <img
                  src={organization.logo}
                  alt={organization.name}
                  className="h-8 w-8 rounded object-cover"
                />
              ) : (
                <Building2 className="h-5 w-5 text-primary" />
              )}
            </div>
            <div>
              <CardTitle className="text-lg">{organization.name}</CardTitle>
              <p className="text-sm text-muted-foreground">@{organization.slug}</p>
            </div>
          </div>
          <Badge variant={roleVariant[organization.role] || "outline"}>
            {roleLabel[organization.role] || organization.role}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
          {organization.settings?.description || "No description"}
        </p>
        <div className="flex gap-2">
          <Link to={`/organizations/${organization.slug}/settings`}>
            <Button variant="outline" size="sm">
              <Settings className="h-4 w-4 mr-1" />
              Settings
            </Button>
          </Link>
          <Link to={`/organizations/${organization.slug}/members`}>
            <Button variant="outline" size="sm">
              <Users className="h-4 w-4 mr-1" />
              Members
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
