import * as Sentry from "@sentry/node";
import { Elysia, ElysiaCustomStatusResponse } from "elysia";

/**
 * HTTP status of an error, by the rule `apps/api`'s own `onError` applies: the `code` of a thrown
 * `status(...)`, the `status` of Elysia's error classes, 500 otherwise. Never the context `code`,
 * which Elysia fills from a numeric `error.code` (a driver's errno). `apps/api` imports this package,
 * so the rule is repeated here and not imported from it.
 */
function httpStatus(error: unknown): number {
  if (error instanceof ElysiaCustomStatusResponse) return error.code;
  if (typeof error === "object" && error !== null && "status" in error) {
    if (typeof error.status === "number") return error.status;
  }
  return 500;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The Elysia plugin that reports unexpected errors to Sentry (or GlitchTip: same DSN protocol).
 * Without `SENTRY_DSN` it does nothing: no client, no hook. With one it starts the SDK and a global
 * `onError` captures an error whose status is 500 or more, and returns nothing, so the `onError` the
 * app registers after it still writes the response. A 4xx is the caller's mistake and is never sent.
 * `options` is for tests (`beforeSend`, `transport`).
 */
export function createObservability(
  env: Record<string, unknown>,
  options: Partial<Sentry.NodeOptions> = {},
) {
  const plugin = new Elysia({ name: "observability" });
  const dsn = text(env.SENTRY_DSN);
  if (!dsn) return plugin;

  Sentry.init({ ...options, dsn, environment: text(env.SENTRY_ENVIRONMENT) });
  return plugin.onError({ as: "global" }, ({ error }) => {
    if (httpStatus(error) >= 500) Sentry.captureException(error);
  });
}

/** What `apps/api` mounts: the plugin over the process environment, read once at import. */
export const observabilityModule = createObservability(process.env);
