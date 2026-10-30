import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
import { branding } from "{{SCOPE}}/config";

import "@fontsource-variable/urbanist/wght.css";
import "@fontsource-variable/faustina/wght.css";

import "{{SCOPE}}/ui/globals.css";

import faviconSvg from "{{SCOPE}}/config/assets/favicons/favicon.svg";
import siteManifest from "{{SCOPE}}/config/assets/favicons/site.webmanifest";

export const links = () => [
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&display=swap",
  },
  { rel: "manifest", href: siteManifest },
  { rel: "icon", type: "image/svg+xml", href: faviconSvg },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#000000" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content={branding.shortName} />
        <meta name="mobile-web-app-capable" content="yes" />

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
