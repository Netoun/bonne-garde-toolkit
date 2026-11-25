import { Link, useLocation } from "react-router";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  useSidebar,
} from "@acme/ui/components/sidebar";
import { cn } from "@acme/ui/lib/utils";

import type { NavSection } from "../nav";
import { isMainNavActive, MAIN_NAV_LINKS } from "./main-nav";

export function SiteSidebar({ sections }: { sections: NavSection[] }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar className="top-14 h-[calc(100svh-3.5rem)] border-r">
      <SidebarContent className="gap-0 overflow-y-auto">
        <SidebarGroup className="border-b pb-2 md:hidden">
          <SidebarGroupLabel className="text-xs text-muted-foreground">Sections</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MAIN_NAV_LINKS.map((item) => {
                const active = isMainNavActive(pathname, item.prefixes);
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      className="h-8 text-sm"
                      render={
                        <Link
                          to={item.href}
                          aria-current={active ? "page" : undefined}
                          onClick={() => {
                            if (isMobile) setOpenMobile(false);
                          }}
                        />
                      }
                    >
                      {item.label}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {sections.map((section) => (
          <SidebarGroup key={section.title} className="py-1">
            <SidebarGroupLabel className="text-[0.6875rem] font-semibold tracking-[0.08em] text-muted-foreground uppercase">
              {section.title}
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {section.links.map((link) => {
                  const active = pathname === link.href || pathname === `${link.href}/`;
                  return (
                    <SidebarMenuItem key={link.href}>
                      <SidebarMenuButton
                        isActive={active}
                        className={cn(
                          "h-auto min-h-7 rounded-l-none border-l-2 py-1 text-sm",
                          active ? "border-docs-accent" : "border-transparent",
                        )}
                        render={
                          <Link
                            to={link.href}
                            onClick={() => {
                              if (isMobile) setOpenMobile(false);
                            }}
                          />
                        }
                      >
                        {link.title}
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  );
                })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        ))}
      </SidebarContent>
    </Sidebar>
  );
}
