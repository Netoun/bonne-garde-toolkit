import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Link, useLocation } from "react-router";

import { Button } from "@acme/ui/components/button";
import { SidebarTrigger } from "@acme/ui/components/sidebar";
import { cn } from "@acme/ui/lib/utils";

import logoUrl from "../../../../assets/logo/logo.svg?url";
import type { NavSection } from "../nav";
import { GitHubIcon } from "./github-icon";
import { isMainNavActive, MAIN_NAV_LINKS } from "./main-nav";
import { SearchDialog } from "./search-dialog";
import { ThemeToggle } from "./theme-toggle";

const GITHUB_URL = "https://github.com/Netoun/bonne-garde-toolkit";

export function SiteHeader({
  showSidebar,
  sections,
}: {
  showSidebar: boolean;
  sections: NavSection[];
}) {
  const { pathname } = useLocation();
  const [searchOpen, setSearchOpen] = useState(false);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "k" || (!event.metaKey && !event.ctrlKey)) return;
      event.preventDefault();
      setSearchOpen(true);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <>
      <SearchDialog sections={sections} open={searchOpen} onOpenChange={setSearchOpen} />
      <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur">
        <div className="flex h-14 items-center gap-3 px-4">
          {showSidebar ? <SidebarTrigger className="-ml-1 md:hidden" /> : null}
          <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <img src={logoUrl} alt="" className="size-7" width={28} height={28} />
            <span className="font-heading text-lg">Bonne Garde</span>
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
                    "border-b-2 px-2.5 py-1 transition-colors duration-150 motion-reduce:transition-none",
                    active
                      ? "border-docs-accent text-foreground"
                      : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="hidden h-8 gap-2 px-2.5 text-muted-foreground md:inline-flex"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="size-3.5 shrink-0 opacity-60" />
              <span className="text-xs">Search documentation…</span>
              <kbd className="pointer-events-none hidden h-5 select-none items-center gap-0.5 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground sm:inline-flex">
                ⌘K
              </kbd>
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="md:hidden"
              aria-label="Search documentation"
              onClick={() => setSearchOpen(true)}
            >
              <Search className="size-4" />
            </Button>
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
    </>
  );
}
