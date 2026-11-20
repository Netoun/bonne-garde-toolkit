import { Link, useLocation } from "react-router";

import { Button } from "@acme/ui/components/button";
import { SidebarTrigger } from "@acme/ui/components/sidebar";
import { cn } from "@acme/ui/lib/utils";

import logoUrl from "../../../../assets/logo/logo.svg?url";
import { GitHubIcon } from "./github-icon";
import { isMainNavActive, MAIN_NAV_LINKS } from "./main-nav";
import { ThemeToggle } from "./theme-toggle";

const GITHUB_URL = "https://github.com/Netoun/bonne-garde-toolkit";

export function SiteHeader({ showSidebar }: { showSidebar: boolean }) {
  const { pathname } = useLocation();

  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-3 px-4">
        {showSidebar ? <SidebarTrigger className="-ml-1 md:hidden" /> : null}
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <img src={logoUrl} alt="" className="size-7" width={28} height={28} />
          <span>Bonne Garde</span>
        </Link>
        <nav
          aria-label="Main"
          className="hidden items-center gap-1 text-sm font-medium md:ml-6 md:flex"
        >
          {MAIN_NAV_LINKS.map((item) => {
            const active = isMainNavActive(pathname, item.prefixes);
            return (
              <Link
                key={item.href}
                to={item.href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-2.5 py-1 transition-colors",
                  active
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon-sm"
            render={
              <a
                href={GITHUB_URL}
                target="_blank"
                rel="noopener noreferrer"
                aria-label="GitHub repository"
              />
            }
          >
            <GitHubIcon className="size-4" />
          </Button>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
