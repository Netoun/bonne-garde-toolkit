import { Calendar, Home, Inbox, Search, Settings } from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
} from "@acme/ui/components/sidebar";

const items = [
  { title: "Home", icon: Home },
  { title: "Inbox", icon: Inbox },
  { title: "Calendar", icon: Calendar },
  { title: "Search", icon: Search },
  { title: "Settings", icon: Settings },
];

export default function SidebarDemo() {
  return (
    <SidebarProvider className="min-h-0 w-full max-w-md border rounded-lg">
      <Sidebar collapsible="none">
        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Application</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {items.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton>
                      <item.icon />
                      <span>{item.title}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </Sidebar>
      <SidebarInset className="flex min-h-[12rem] items-start p-4">
        <SidebarTrigger />
        <p className="text-sm text-muted-foreground">Sidebar demo with collapsible trigger.</p>
      </SidebarInset>
    </SidebarProvider>
  );
}
