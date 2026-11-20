export const MAIN_NAV_LINKS = [
  { label: "Docs", href: "/docs/introduction", prefixes: ["/docs"] },
  { label: "Components", href: "/components/button", prefixes: ["/components", "/blocks"] },
  { label: "Modules", href: "/modules/ui/shadcn", prefixes: ["/modules"] },
] as const;

export function isMainNavActive(pathname: string, prefixes: readonly string[]): boolean {
  const path = pathname.replace(/\/$/, "") || "/";
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}
