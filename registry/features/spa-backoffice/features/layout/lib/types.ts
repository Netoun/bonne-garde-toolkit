import type { ComponentType } from "react";

export interface RouteHandle {
  header?: ComponentType;
  breadcrumb?: ComponentType<{ params: Record<string, string> }>;
}

export function isRouteHandle(handle: unknown): handle is RouteHandle {
  return typeof handle === "object" && handle !== null;
}
