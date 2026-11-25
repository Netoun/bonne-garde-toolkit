import type { LucideIcon } from "lucide-react";
import {
  BookOpen,
  Boxes,
  Component as ComponentIcon,
  Folder,
  LayoutTemplate,
  Scale,
  Wrench,
} from "lucide-react";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  useSidebar,
} from "@acme/ui/components/sidebar";

import type { NavSection } from "../nav";
import { isMainNavActive, MAIN_NAV_LINKS } from "./main-nav";

const SECTION_ICON_BY_TITLE: Record<string, LucideIcon> = {
  Guides: BookOpen,
  Decisions: Scale,
  Components: ComponentIcon,
  Utilities: Wrench,
  Blocks: LayoutTemplate,
};

function getSectionIcon(title: string): LucideIcon {
  const mapped = SECTION_ICON_BY_TITLE[title];
  if (mapped) return mapped;
  if (/^[a-z][a-z0-9-]*$/.test(title)) return Boxes;
  return Folder;
}

function isNavLinkActive(pathname: string, href: string): boolean {
  return pathname === href || pathname === `${href}/`;
}

export function SiteSidebar({ sections }: { sections: NavSection[] }) {
  const { pathname } = useLocation();
  const { isMobile, setOpenMobile } = useSidebar();

  return (
    <Sidebar className="top-14 h-[calc(100svh-3.5rem)] border-r">
      <SidebarContent className="gap-1 overflow-y-auto px-2 py-4">
        <SidebarGroup className="border-b pb-2 md:hidden">
          <SidebarGroupLabel className="text-xs text-sidebar-foreground/70">
            Sections
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {MAIN_NAV_LINKS.map((item) => {
                const active = isMainNavActive(pathname, item.prefixes);
                const Icon = item.icon;
                return (
                  <SidebarMenuItem key={item.href}>
                    <SidebarMenuButton
                      isActive={active}
                      size="sm"
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
                      <Icon />
                      <span>{item.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
        {sections.map((section) => {
          const SectionIcon = getSectionIcon(section.title);
          return (
            <SidebarGroup key={section.title}>
              <SidebarGroupContent>
                <SidebarMenu>
                  <SidebarMenuItem>
                    <SidebarMenuButton
                      size="sm"
                      className="pointer-events-none text-xs text-sidebar-foreground/70 hover:bg-transparent hover:text-sidebar-foreground/70 active:bg-transparent active:text-sidebar-foreground/70"
                    >
                      <SectionIcon />
                      <span>{section.title}</span>
                    </SidebarMenuButton>
                    <SidebarMenuSub>
                      {section.links.map((link) => {
                        const active = isNavLinkActive(pathname, link.href);
                        return (
                          <SidebarMenuSubItem key={link.href}>
                            <SidebarMenuSubButton
                              isActive={active}
                              render={
                                <Link
                                  to={link.href}
                                  onClick={() => {
                                    if (isMobile) setOpenMobile(false);
                                  }}
                                />
                              }
                            >
                              <span>{link.title}</span>
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        );
                      })}
                    </SidebarMenuSub>
                  </SidebarMenuItem>
                </SidebarMenu>
              </SidebarGroupContent>
            </SidebarGroup>
          );
        })}
      </SidebarContent>
    </Sidebar>
  );
}
