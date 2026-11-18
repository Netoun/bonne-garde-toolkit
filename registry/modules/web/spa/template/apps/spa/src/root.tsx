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
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { branding, faviconLinks } from "{{SCOPE}}/config";
import { QueryProvider } from "./providers/query-provider";
import { AppLoader } from "./components/app-loader";
import { useInitTheme } from "./hooks/use-init-theme";
import useLoadApp from "./hooks/use-load-app";

import "@fontsource-variable/urbanist/wght.css";
import "@fontsource-variable/faustina/wght.css";

import "{{SCOPE}}/ui/globals.css";

export const links: Route.LinksFunction = () => [...faviconLinks];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang={branding.lang}>
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
  // The shell has no session to wait for, so nothing is ever pending.
  const { contentOpacity, shouldShowLoader } = useLoadApp(false);

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
