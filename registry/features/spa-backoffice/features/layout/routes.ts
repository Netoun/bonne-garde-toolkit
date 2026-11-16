import { index, layout, route, type RouteConfig } from "@react-router/dev/routes";

export default [
  index("features/dashboard/pages/dashboard-redirect.tsx"),

  layout("features/layout/pages/layout-app-layout.tsx", [
    route("dashboard", "features/dashboard/pages/dashboard-page.tsx"),
    route("organizations", "features/organization/pages/organization-page.tsx"),
    route("organizations/new", "features/organization/pages/organization-new-page.tsx"),
    route(
      "organizations/:organizationSlug/settings",
      "features/organization/pages/organization-settings-page.tsx",
    ),
    route(
      "organizations/:organizationSlug/members",
      "features/organization/pages/organization-members-page.tsx",
    ),
  ]),
] satisfies RouteConfig;
