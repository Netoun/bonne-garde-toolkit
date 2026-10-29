import type { Route } from "./+types/root";
import { Suspense } from "react";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
} from "react-router";
import { QueryProvider } from "./providers/query-provider";
import { useSession } from "@acme/spa/hooks/use-session";
import { AppLoader } from "./components/app-loader";
import { useAuthRedirect } from "./hooks/use-auth-redirect";
import { useInitTheme } from "./hooks/use-init-theme";
import useLoadApp from "./hooks/use-load-app";

import "@fontsource-variable/urbanist/wght.css";
import "@fontsource-variable/faustina/wght.css";

import faviconSvg from "@acme/assets/favicons/favicon.svg";
import siteManifest from "@acme/assets/favicons/site.webmanifest";

import "@acme/ui/styles/globals.css";

export const links: Route.LinksFunction = () => [
  { rel: "icon", type: "image/svg+xml", href: faviconSvg },
  { rel: "manifest", href: siteManifest },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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

function AppContent() {
  const { isPending } = useSession();
  const { contentOpacity, shouldShowLoader } = useLoadApp(isPending);

  useAuthRedirect();
  useInitTheme();

  return (
    <>
      {shouldShowLoader && <AppLoader />}

      <div
        className="transition-opacity duration-500 ease-in-out"
        style={{ opacity: contentOpacity }}
      >
        <Outlet />
      </div>
    </>
  );
}

export default function App() {
  return (
    <QueryProvider>
      <Suspense fallback={<AppLoader />}>
        <AppContent />
      </Suspense>
    </QueryProvider>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404 ? "The requested page could not be found." : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
