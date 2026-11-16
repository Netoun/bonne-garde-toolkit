import { Building2, Plus } from "lucide-react";
import { PageHeader } from "../../layout/components/layout-page-header";

export function OrganizationHeader() {
  const actions = [
    {
      label: "Nouvelle organisation",
      icon: Plus,
      href: "/organizations/new",
    },
  ];

  return <PageHeader title="Organisations" icon={Building2} actions={actions} />;
}
