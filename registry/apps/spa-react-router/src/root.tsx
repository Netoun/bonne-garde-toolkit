import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { branding } from "@acme/config";
import appCss from "./app.css?url";

export const links = () => [{ rel: "stylesheet", href: appCss }];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{branding.displayName} — Backoffice</title>
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
    <main style={{ padding: "2rem" }}>
      <h1>Error</h1>
      <p>{error instanceof Error ? error.message : "Unexpected error"}</p>
    </main>
  );
}
