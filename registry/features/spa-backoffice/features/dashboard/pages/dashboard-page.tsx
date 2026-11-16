import { PageHeader } from "../../layout/components/layout-page-header";
import { branding } from "@acme/config";

export const handle = {
  header: PageHeader,
};

export default function Dashboard() {
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">Dashboard</h1>
      <p className="text-muted-foreground">
        Bienvenue sur {branding.displayName}. Commencez par configurer votre organisation.
      </p>
    </div>
  );
}
