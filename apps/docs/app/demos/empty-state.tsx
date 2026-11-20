import { Inbox } from "lucide-react";

import { EmptyState } from "@acme/ui/components/empty-state";

export default function EmptyStateDemo() {
  return (
    <EmptyState
      icon={Inbox}
      title="No messages"
      description="When you receive messages they will show up here."
      action={{ label: "Refresh" }}
    />
  );
}
