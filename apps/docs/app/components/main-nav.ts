import type { LucideIcon } from "lucide-react";
import { BookOpen, Boxes, Component } from "lucide-react";

export const MAIN_NAV_LINKS = [
  { label: "Docs", href: "/docs/introduction", prefixes: ["/docs"], icon: BookOpen },
  {
    label: "Components",
    href: "/components/button",
    prefixes: ["/components", "/blocks"],
    icon: Component,
  },
  { label: "Modules", href: "/modules/ui/shadcn", prefixes: ["/modules"], icon: Boxes },
] as const satisfies ReadonlyArray<{
  label: string;
  href: string;
  prefixes: readonly string[];
  icon: LucideIcon;
}>;

export function isMainNavActive(pathname: string, prefixes: readonly string[]): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
