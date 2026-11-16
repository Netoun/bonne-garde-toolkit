import * as React from "react";
import { branding } from "@acme/config";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@acme/ui/components/sidebar";
import { LayoutOrgSwitcher } from "./layout-org-switcher";
import { LayoutNavMain } from "./layout-nav-main";
import { LayoutNavUser } from "./layout-nav-user";
export function LayoutAppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar
      collapsible="icon"
      className="border-r border-sidebar-border/50 bg-sidebar-background overflow-hidden"
      {...props}
    >
      <SidebarHeader className="relative z-10 py-4">
        <div className="px-3 group-data-[collapsible=icon]:px-1 mb-2">
          <div className="flex items-center gap-3 group cursor-default">
            <div className="size-8 group-data-[collapsible=icon]:size-6 rounded-lg bg-linear-to-br from-primary/20 to-primary/10 flex items-center justify-center transition-all duration-300 ease-out group-hover:scale-105 shadow-md">
              <span className="font-heading text-sm font-bold text-primary">
                {branding.shortName
                  .split(/\s+/)
                  .map((part) => part[0] ?? "")
                  .join("")
                  .slice(0, 2)
                  .toUpperCase()}
              </span>
            </div>
            <div className="flex flex-col group-data-[collapsible=icon]:hidden">
              <span className="font-heading text-lg font-semibold tracking-tight leading-none text-foreground">
                {branding.displayName}
              </span>
              <span className="text-[10px] uppercase tracking-[0.2em] font-medium mt-0.5 text-secondary">
                Backoffice
              </span>
            </div>
          </div>
        </div>

        <LayoutOrgSwitcher />
      </SidebarHeader>

      <SidebarContent className="relative z-10">
        <LayoutNavMain />
      </SidebarContent>

      <SidebarFooter className="relative z-10">
        {/* Decorative line above user */}
        <div className="mx-3 mb-3">
          <div className="h-px w-full bg-linear-to-r from-transparent via-border to-transparent" />
        </div>
        <LayoutNavUser />
      </SidebarFooter>

      <SidebarRail className="after:bg-transparent hover:after:bg-sidebar-accent/50" />
    </Sidebar>
  );
}
