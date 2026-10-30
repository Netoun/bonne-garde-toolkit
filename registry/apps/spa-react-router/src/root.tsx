import type { ReactNode } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { branding } from "@acme/config";
import { Button } from "@acme/ui/components/button";
import appCss from "./app.css?url";

export const links = () => [{ rel: "stylesheet", href: appCss }];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{`${branding.displayName} — Backoffice`}</title>
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: { error: unknown }) {
  return (
    <main className="flex flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-semibold">Error</h1>
      <p>{error instanceof Error ? error.message : "Unexpected error"}</p>
      <Button onClick={() => window.location.assign("/")}>Back to home</Button>
    </main>
  );
}
