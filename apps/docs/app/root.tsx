import {
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLoaderData,
  useLocation,
} from "react-router";

import faviconUrl from "../../../assets/logo/logo-mark-blue.svg?url";
import type { Route } from "./+types/root";
import appCss from "./app.css?url";
import { SiteLayout } from "./components/site-layout";
import { docsThemeInitScript } from "./components/theme-toggle";
import { readCachedNav } from "./lib/nav-cache";
import type { NavSection } from "./nav";

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: faviconUrl, type: "image/svg+xml" },
];

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
  const { pathname } = useLocation();
  const showSidebar = pathname !== "/" && pathname !== "";
  return (
    <SiteLayout sections={sections} showSidebar={showSidebar}>
      <Outlet />
    </SiteLayout>
  );
}
