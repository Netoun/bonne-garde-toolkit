import { useEffect } from "react";
import { Outlet, useNavigate } from "react-router";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@acme/ui/components/sidebar";
import { TooltipProvider } from "@acme/ui/components/tooltip";
import { Separator } from "@acme/ui/components/separator";
import { ThemeToggle } from "@acme/spa/features/auth/components/theme-toggle";
import { LayoutAppSidebar } from "../components/layout-app-sidebar";
import { useAuthRedirect } from "@acme/spa/features/auth/hooks/use-auth-redirect";
import { useSession } from "@acme/spa/features/auth/hooks/use-session";
import { useOrganizations } from "@acme/spa/features/organization/hooks/use-organization";
import { LayoutDynamicBreadcrumb } from "../components/layout-dynamic-breadcrumb";
import { useRouteHeader } from "../hooks/use-route-header";

export default function AppLayout() {
  const Header = useRouteHeader();
  const navigate = useNavigate();
  const { data, isPending } = useSession();
  const { isPending: orgsPending, error: orgsError } = useOrganizations({ enabled: !!data });

  useEffect(() => {
    if (isPending) return;
    if (!data) {
      navigate("/auth/login");
      return;
    }
    if (orgsError) {
      navigate("/auth/login");
      return;
    }
    if (orgsPending) return;
  }, [isPending, orgsPending, data, orgsError, navigate]);

  // After the effect above: this redirect to the login page keeps where the visitor was going,
  // so it has to be the last navigation.
  useAuthRedirect();

  if (isPending || orgsPending) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <p className="text-muted-foreground">Chargement...</p>
      </div>
    );
  }

  if (!data || orgsError) {
    return null;
  }

  return (
    <TooltipProvider>
      <SidebarProvider>
        <LayoutAppSidebar />
        <SidebarInset className="py-2 px-4">
          <header className="print:hidden flex h-14 items-center justify-between mb-2">
            <div className="flex items-center md:gap-2">
              <SidebarTrigger />
              <Separator orientation="vertical" className="mr-2 md:mr-4" />
            </div>
            {Header && <Header />}
            <div className="flex items-center md:gap-2">
              <Separator orientation="vertical" className="md:ml-4" />
              <ThemeToggle />
            </div>
          </header>
          <div className="mb-4">
            <LayoutDynamicBreadcrumb />
          </div>
          <Outlet />
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
