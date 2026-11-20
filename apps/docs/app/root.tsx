import { Links, Meta, Outlet, Scripts, ScrollRestoration, useLoaderData } from "react-router";

import appCss from "./app.css?url";
import { SiteLayout } from "./components/site-layout";
import { docsThemeInitScript } from "./components/theme-toggle";
import { readCachedNav } from "./lib/nav-cache";
import type { NavSection } from "./nav";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Bonne Garde</title>
        <script dangerouslySetInnerHTML={{ __html: docsThemeInitScript() }} />
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

export async function loader() {
  const sections = readCachedNav() ?? [];
  return { sections };
}

export default function App() {
  const { sections } = useLoaderData<{ sections: NavSection[] }>();
  return (
    <SiteLayout sections={sections}>
      <Outlet />
    </SiteLayout>
  );
}
