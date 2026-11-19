import { Link } from "react-router";

import { Button } from "@acme/ui/components/button";
import { SidebarTrigger } from "@acme/ui/components/sidebar";

import logoUrl from "../../../../assets/logo/logo.svg?url";
import { ThemeToggle } from "./theme-toggle";

const GITHUB_URL = "https://github.com/Netoun/bonne-garde-toolkit";

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-50 w-full border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="flex h-14 items-center gap-3 px-4">
        <SidebarTrigger className="-ml-1 md:hidden" />
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <img src={logoUrl} alt="" className="size-7" width={28} height={28} />
          <span>Bonne Garde</span>
        </Link>
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            render={
              <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer">
                GitHub
              </a>
            }
          />
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
