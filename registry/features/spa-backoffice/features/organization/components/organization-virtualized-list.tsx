import { useRef } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { OrganizationCard } from "./organization-card";
import type { Organization } from "../hooks/use-organization";

interface OrganizationVirtualizedListProps {
  organizations: Organization[];
}

export function OrganizationVirtualizedList({ organizations }: OrganizationVirtualizedListProps) {
  const parentRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: organizations.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 180, // Estimated card height
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      className="h-[600px] overflow-auto"
      style={{
        contain: "strict",
      }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const org = organizations[virtualItem.index];
          return (
            <div
              key={virtualItem.key}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualItem.start}px)`,
                paddingBottom: "16px",
              }}
            >
              <OrganizationCard organization={org} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
