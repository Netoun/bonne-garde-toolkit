import { SidebarInset, SidebarProvider } from "@acme/ui/components/sidebar";

import { useLocation } from "react-router";

import { adjacentLinks, type NavSection } from "../nav";
import { DocPager } from "./doc-pager";
import { SiteHeader } from "./site-header";
import { SiteSidebar } from "./site-sidebar";

export function SiteLayout({
  sections,
  children,
  showSidebar,
}: {
  sections: NavSection[];
  children: React.ReactNode;
  showSidebar: boolean;
}) {
  const { pathname } = useLocation();

  if (!showSidebar) {
    return (
      <div className="flex min-h-svh flex-col">
        <SiteHeader showSidebar={false} />
        <main className="flex-1">{children}</main>
      </div>
    );
  }

  return (
    <SidebarProvider className="min-h-svh flex-col">
      <SiteHeader showSidebar />
      <div className="flex w-full flex-1">
        <SiteSidebar sections={sections} />
        <SidebarInset className="overflow-x-hidden">
          <div className="flex-1 px-6 py-10">
            {children}
            <div className="mx-auto max-w-3xl">
              <DocPager {...adjacentLinks(sections, pathname)} />
            </div>
          </div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
