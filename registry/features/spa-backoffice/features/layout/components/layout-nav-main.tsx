import * as React from "react";
import { useLocation, NavLink } from "react-router";
import { LayoutDashboard, Building2, Users } from "lucide-react";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@acme/ui/components/sidebar";
import { useOrganizations } from "@acme/spa/features/organization/hooks/use-organization";

interface NavItem {
  title: string;
  url: string;
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
}

function useNavigationItems(): NavItem[] {
  const { data: organizations } = useOrganizations();

  const baseItems: NavItem[] = [
    {
      title: "Dashboard",
      url: "/dashboard",
      icon: LayoutDashboard,
    },
  ];

  baseItems.push({
    title: "Organizations",
    url: "/organizations",
    icon: Building2,
  });

  if (organizations && organizations.length > 0) {
    const firstOrg = organizations[0];
    baseItems.push({
      title: "My organization",
      url: `/organizations/${firstOrg.slug}/members`,
      icon: Users,
    });
  }

  return baseItems;
}

function isActiveRoute(locationPath: string, itemUrl: string): boolean {
  if (locationPath === itemUrl) return true;
  return locationPath.startsWith(`${itemUrl}/`);
}

export function LayoutNavMain() {
  const location = useLocation();
  const navigationItems = useNavigationItems();

  return (
    <SidebarGroup>
      <SidebarGroupLabel className="text-[10px] uppercase tracking-[0.15em] font-semibold mb-2 px-3 text-muted-foreground">
        Navigation
      </SidebarGroupLabel>
      <SidebarMenu className="gap-0.5">
        {navigationItems.map((item) => {
          const isActive = isActiveRoute(location.pathname, item.url);
          const Icon = item.icon;

          return (
            <SidebarMenuItem key={item.url}>
              <SidebarMenuButton
                isActive={isActive}
                tooltip={item.title}
                className={`
                  group relative overflow-hidden rounded-lg
                  transition-all duration-300 ease-out
                  ${
                    isActive
                      ? "bg-linear-to-r from-primary/20 to-primary/5"
                      : "hover:bg-sidebar-accent/60"
                  }
                `}
                render={
                  <NavLink to={item.url} className="flex items-center gap-3 w-full px-2 py-2">
                    <div
                      className={`
                        flex items-center justify-center size-6 rounded-sm
                        transition-all duration-300 ease-out
                        ${
                          isActive
                            ? "bg-primary/50 shadow-sm"
                            : "bg-transparent group-hover:bg-primary/10"
                        }
                      `}
                    >
                      <Icon
                        className={`
                          size-3 transition-all duration-300
                          ${isActive ? "" : "text-muted-foreground group-hover:text-foreground"}
                        `}
                        strokeWidth={isActive ? 2 : 1.5}
                      />
                    </div>

                    <span
                      className={`
                        text-base transition-all duration-300
                        ${
                          isActive
                            ? "font-medium text-foreground"
                            : "text-muted-foreground group-hover:text-foreground"
                        }
                      `}
                    >
                      {item.title}
                    </span>

                    {/* Hover glow effect - simplified */}
                    <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-primary/5" />
                  </NavLink>
                }
              ></SidebarMenuButton>
            </SidebarMenuItem>
          );
        })}
      </SidebarMenu>
    </SidebarGroup>
  );
}
