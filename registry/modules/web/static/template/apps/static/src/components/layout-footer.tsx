import { branding } from "{{SCOPE}}/config";

export function LayoutFooter() {
  return (
    <footer className="border-t border-border px-8 py-10">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-6">
        <p className="font-heading text-lg font-semibold tracking-tight">{branding.displayName}</p>
        <p className="text-sm text-muted-foreground">
          © {new Date().getFullYear()} {branding.legalName} · Tous droits réservés
        </p>
      </div>
    </footer>
  );
}
