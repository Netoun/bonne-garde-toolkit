import { SidebarInset, SidebarProvider } from "@acme/ui/components/sidebar";

import type { NavSection } from "../nav";
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
          <div className="flex-1 px-6 py-10">{children}</div>
        </SidebarInset>
      </div>
    </SidebarProvider>
  );
}
