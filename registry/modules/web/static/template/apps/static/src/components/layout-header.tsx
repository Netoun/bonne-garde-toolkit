import { branding } from "{{SCOPE}}/config";

export const LayoutHeader = () => {
  return (
    <header className="px-6 py-5 border-b border-border">
      <a
        href="/"
        className="font-heading text-xl font-semibold tracking-tight hover:opacity-80 transition-opacity"
      >
        {branding.displayName}
      </a>
    </header>
  );
};
