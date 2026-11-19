import { SidebarInset, SidebarProvider } from "@acme/ui/components/sidebar";

import type { NavSection } from "../nav";
import { SiteHeader } from "./site-header";
import { SiteSidebar } from "./site-sidebar";

export function SiteLayout({
  sections,
  children,
}: {
  sections: NavSection[];
  children: React.ReactNode;
}) {
  return (
    <SidebarProvider className="flex-col">
      <SiteHeader />
      <div className="flex w-full flex-1">
        <SiteSidebar sections={sections} />
        <SidebarInset>
          <div className="mx-auto w-full max-w-3xl flex-1 px-6 py-10">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
