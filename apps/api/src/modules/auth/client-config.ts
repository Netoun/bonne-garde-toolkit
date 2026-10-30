import type { Env } from "@acme/api/lib/env";
import { allowedOrigins } from "@acme/api/lib/origins";

export function getAuthClientConfig(env: Pick<Env, "API_URL" | "SPA_URL" | "SSR_URL">) {
  return {
    baseURL: env.API_URL,
    trustedOrigins: allowedOrigins(env),
  } as const;
}
