import type { ComponentType } from "react";
import { useMatches } from "react-router";
import { isRouteHandle } from "../lib/types";

export function useRouteHeader(): ComponentType | undefined {
  const matches = useMatches();

  for (const match of matches) {
    if (isRouteHandle(match.handle) && match.handle.header) {
      return match.handle.header;
    }
  }

  return undefined;
}
