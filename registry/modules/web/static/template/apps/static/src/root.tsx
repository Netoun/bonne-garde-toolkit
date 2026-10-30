import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { branding } from "{{SCOPE}}/config";

import urbanistFont from "@fontsource-variable/urbanist/files/urbanist-latin-wght-normal.woff2?url";
import fastinaFont from "@fontsource-variable/faustina/files/faustina-latin-wght-normal.woff2?url";
import faviconSvg from "{{SCOPE}}/config/assets/favicons/favicon.svg";
import siteManifest from "{{SCOPE}}/config/assets/favicons/site.webmanifest";

import "@fontsource-variable/urbanist/wght.css";
import "@fontsource-variable/faustina/wght.css";
import appCss from "./app.css?url";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <link rel="preload" as="font" type="font/woff2" href={urbanistFont} crossOrigin="" />
        <link rel="preload" as="font" type="font/woff2" href={fastinaFont} crossOrigin="" />
        <meta name="robots" content="index, follow" />
        <meta name="author" content={branding.legalName} />
        <link rel="icon" type="image/svg+xml" href={faviconSvg} />
        <link rel="manifest" href={siteManifest} />
        <link rel="stylesheet" href={appCss} />
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
    <main className="container mx-auto p-4 pt-16">
      <h1>Error</h1>
      <p>{error instanceof Error ? error.message : "An unexpected error occurred."}</p>
    </main>
  );
}
