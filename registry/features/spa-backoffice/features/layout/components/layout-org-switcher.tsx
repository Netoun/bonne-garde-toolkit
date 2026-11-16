import * as React from "react";
import { ChevronsUpDown, Building2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@acme/ui/components/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@acme/ui/components/sidebar";
import { useUIStore } from "@acme/spa/stores/ui.store";

const organizations = [{ id: "1", name: "My Organization" }];

export function LayoutOrgSwitcher() {
  const { isMobile } = useSidebar();
  const { activeOrgId, setActiveOrg } = useUIStore();

  const activeOrg = organizations.find((org) => org.id === activeOrgId) || organizations[0];

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <SidebarMenuButton
                size="lg"
                className="group relative overflow-hidden transition-all duration-300 hover:bg-sidebar-accent/70 data-[state=open]:bg-sidebar-accent rounded-[0.625rem]"
              >
                {/* Subtle gradient background on hover - simplified */}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none bg-primary/5" />

                <div className="flex aspect-square size-9 items-center justify-center rounded-xl transition-all duration-300 group-hover:scale-105 bg-linear-to-br from-primary/15 to-secondary/10 border border-primary/20 shadow-sm">
                  <Building2
                    className="size-[18px] transition-transform duration-300 group-hover:scale-110 text-muted-foreground"
                    strokeWidth={1.5}
                  />
                </div>

                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium text-foreground">{activeOrg.name}</span>
                  <span className="truncate text-[11px] text-muted-foreground">Organization</span>
                </div>

                <ChevronsUpDown
                  className="ml-auto size-4 opacity-50 transition-transform duration-300 group-data-[state=open]:rotate-180"
                  strokeWidth={1.5}
                />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl border-sidebar-border/60 bg-card shadow-lg"
            align="start"
            side={isMobile ? "bottom" : "right"}
            sideOffset={8}
          >
            <DropdownMenuGroup className="p-1">
              <DropdownMenuLabel className="text-[10px] uppercase tracking-[0.15em] font-semibold px-2 py-1.5 text-muted-foreground">
                Organizations
              </DropdownMenuLabel>
              {organizations.map((org) => (
                <DropdownMenuItem
                  key={org.id}
                  onClick={() => setActiveOrg(org.id)}
                  className="gap-3 p-2.5 rounded-lg cursor-pointer transition-all duration-200"
                >
                  <div className="flex size-8 items-center justify-center rounded-lg bg-linear-to-br from-primary/15 to-secondary/10 border border-primary/15">
                    <Building2
                      className="size-4 shrink-0 text-muted-foreground"
                      strokeWidth={1.5}
                    />
                  </div>
                  <span className="text-sm font-medium">{org.name}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>

            <DropdownMenuSeparator className="bg-sidebar-border/50" />

            <DropdownMenuGroup className="p-1">
              <DropdownMenuItem
                className="gap-3 p-2.5 rounded-lg cursor-not-allowed opacity-50"
                disabled
              >
                <div className="flex size-8 items-center justify-center rounded-lg border bg-muted">
                  <span className="text-sm font-medium">+</span>
                </div>
                <span className="text-sm text-muted-foreground">Create an organization</span>
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
