import { useNavigate } from "react-router";
import { authClient } from "@acme/spa/lib/auth";
import { useSession } from "@acme/spa/hooks/use-session";
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
import { Avatar, AvatarFallback } from "@acme/ui/components/avatar";
import { LogOut, User, Settings } from "lucide-react";

function getInitials(user: { email?: string; name?: string }): string {
  if (user.name) {
    return user.name
      .split(" ")
      .map((n) => n[0])
      .slice(0, 2)
      .join("")
      .toUpperCase();
  }
  if (user.email) {
    const localPart = user.email.split("@")[0];
    const parts = localPart.split(/[._-]/).filter(Boolean);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[1][0]).toUpperCase();
    }
    return localPart.slice(0, 2).toUpperCase();
  }
  return "??";
}

export function LayoutNavUser() {
  const { isMobile } = useSidebar();
  const navigate = useNavigate();
  const { data: session } = useSession();

  const user = session?.user;
  const initials = user ? getInitials(user) : "??";

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
    } finally {
      navigate("/auth/login");
    }
  };

  if (!user) return null;

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

                <Avatar className="h-9 w-9 rounded-xl transition-transform duration-300 group-hover:scale-105 shadow-sm">
                  <AvatarFallback className="rounded-xl text-xs font-medium bg-linear-to-br from-primary to-primary-300 text-primary-foreground">
                    {initials}
                  </AvatarFallback>
                </Avatar>

                <div className="grid flex-1 text-left leading-tight">
                  <span className="truncate font-medium text-foreground">
                    {user.name || user.email}
                  </span>
                  <span className="truncate text-[11px] text-muted-foreground">{user.email}</span>
                </div>
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl border-sidebar-border/60 bg-card shadow-lg"
            side={isMobile ? "bottom" : "right"}
            align="end"
            sideOffset={8}
          >
            <DropdownMenuGroup>
              <DropdownMenuLabel className="p-0 font-normal">
                <div className="flex items-center gap-3 px-3 py-3 text-left bg-linear-to-br from-muted/80 to-muted rounded-t-xl">
                  <Avatar className="h-10 w-10 rounded-xl shadow-sm">
                    <AvatarFallback className="rounded-xl text-xs font-medium bg-linear-to-br from-primary to-primary-300 text-primary-foreground">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="grid flex-1 text-left leading-tight">
                    <span className="truncate text-sm font-medium text-foreground">
                      {user.name || user.email}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">{user.email}</span>
                  </div>
                </div>
              </DropdownMenuLabel>
            </DropdownMenuGroup>

            <DropdownMenuSeparator className="bg-sidebar-border/50" />

            <DropdownMenuGroup className="p-1">
              <DropdownMenuItem
                disabled
                className="cursor-not-allowed opacity-50 rounded-lg text-sm"
              >
                <User className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Profile
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled
                className="cursor-not-allowed opacity-50 rounded-lg text-sm"
              >
                <Settings className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Settings
              </DropdownMenuItem>
            </DropdownMenuGroup>

            <DropdownMenuSeparator className="bg-sidebar-border/50" />

            <DropdownMenuGroup className="p-1">
              <DropdownMenuItem
                onClick={handleSignOut}
                className="rounded-lg text-sm cursor-pointer transition-colors duration-200 text-destructive"
              >
                <LogOut className="mr-2 h-4 w-4" strokeWidth={1.5} />
                Sign out
              </DropdownMenuItem>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
