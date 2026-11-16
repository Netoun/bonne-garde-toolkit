import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";
// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding, faviconLinks } from "{{SCOPE}}/config";

import "@fontsource-variable/urbanist/wght.css";
import "@fontsource-variable/faustina/wght.css";

import "{{SCOPE}}/ui/globals.css";

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
  ...faviconLinks,
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={branding.lang}>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content={branding.themeColor} />
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
