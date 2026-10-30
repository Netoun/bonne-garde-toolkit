import { config } from "@acme/api/lib/app.config";
import type { Env } from "@acme/api/lib/env";

const CORS_ALLOW_METHODS = "GET, POST, PUT, DELETE, OPTIONS, PATCH";
const CORS_ALLOW_HEADERS = "Content-Type, Authorization";

/** Configured front-end URLs (`apps/spa`, `apps/ssr`), empty entries dropped. */
export function allowedOrigins(env: Pick<Env, "SPA_URL" | "SSR_URL"> = config): string[] {
  return [env.SPA_URL, env.SSR_URL].filter(Boolean);
}

/** Canonical `scheme://host[:port]` of a URL, or `null` when it cannot be parsed. */
function toOrigin(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * Whether an `Origin` header value matches a configured front-end URL.
 * Both sides are normalised (case, trailing slash, default port), and a value
 * that cannot be parsed is rejected rather than thrown on.
 */
export function originAllowed(origin: string): boolean {
  const requested = toOrigin(origin);
  // `new URL("file:///x").origin` is the opaque origin "null": never trust it.
  if (requested === null || requested === "null") return false;
  return allowedOrigins().some((allowed) => toOrigin(allowed) === requested);
}

/** Add CORS headers to a response for an allowed origin; any other response is returned as is. */
export function applyCorsHeaders(req: Request, response: Response): Response {
  const origin = req.headers.get("origin") ?? "";
  if (!originAllowed(origin)) return response;

  const res = new Response(response.body, response);
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", CORS_ALLOW_METHODS);
  res.headers.set("Access-Control-Allow-Headers", CORS_ALLOW_HEADERS);
  return res;
}
