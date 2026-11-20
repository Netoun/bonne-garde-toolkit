import { Box } from "lucide-react";

import { EntityCard } from "@acme/ui/components/entity-card";

export default function EntityCardDemo() {
  return (
    <div className="w-full max-w-md">
      <EntityCard
        title="Inventory item"
        subtitle="SKU-28491"
        description="Tracked unit in the main warehouse with low-stock alerts enabled."
        icon={<Box className="h-5 w-5 text-primary" />}
        badges={[{ label: "Active", variant: "secondary" }]}
        footer={<p className="text-xs text-muted-foreground">Updated 2 hours ago</p>}
      />
    </div>
  );
}
