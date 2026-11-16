import { useMatches } from "react-router";
import type { RouteHandle } from "../lib/types";

interface Match {
  handle?: unknown;
  params: Record<string, string>;
}

export function useBreadcrumbs(): Array<{
  handle: RouteHandle;
  params: Record<string, string>;
}> {
  const matches = useMatches() as Match[];
  const breadcrumbs: Array<{ handle: RouteHandle; params: Record<string, string> }> = [];

  for (const match of matches) {
    const handle = match.handle as unknown;
    if (
      typeof handle === "object" &&
      handle !== null &&
      "breadcrumb" in handle &&
      handle.breadcrumb !== undefined
    ) {
      breadcrumbs.push({
        handle: handle as RouteHandle,
        params: match.params,
      });
    }
  }

  return breadcrumbs;
}
