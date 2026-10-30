import { treaty } from "@elysiajs/eden";
import type { App } from "{{SCOPE}}/api/app";
import type { RouterContextProvider } from "react-router";
import { cloudflareContext } from "./cloudflare-context";

// `bg add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
export type { ApiRoute, EdenResponse, EdenBody, EdenQuery } from "{{SCOPE}}/api/lib/eden";

function resolveApiUrl(context: Readonly<RouterContextProvider>): string {
  const apiUrl = context.get(cloudflareContext)?.env.API_URL;
  if (apiUrl) {
    new URL(apiUrl);
    return apiUrl;
  }

  if (import.meta.env.DEV) {
    return "http://localhost:5172";
  }

  throw new Error("Missing API_URL in Cloudflare environment");
}

/**
 * SSR-only Eden Treaty client factory.
 * Forwards request cookies for authenticated routes.
 *
 * Usage in loaders/actions:
 *   const api = createApi(context, request);
 *   const { data: game } = await api.games({ slug: "my-game" }).get();
 */
export function createApi(context: Readonly<RouterContextProvider>, request?: Request) {
  const apiUrl = resolveApiUrl(context);
  const cookieHeader = request?.headers.get("cookie") ?? "";
  return treaty<App>(apiUrl, {
    headers: cookieHeader ? { cookie: cookieHeader } : {},
    fetch: {
      credentials: "include",
    },
  });
}

export type ApiClient = ReturnType<typeof createApi>;
