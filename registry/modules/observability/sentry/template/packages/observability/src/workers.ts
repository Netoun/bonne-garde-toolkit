import * as Sentry from "@sentry/cloudflare";
import { wrapRequestHandler } from "@sentry/cloudflare/request";
import { Elysia, ElysiaCustomStatusResponse } from "elysia";
import { readRuntimeEnv, wrapRequests, type RequestWrapper } from "{{SCOPE}}/api-runtime";

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

type WorkersOptions = Parameters<typeof wrapRequestHandler>[0]["options"];

/**
 * Error reporting to Sentry (or GlitchTip: same DSN protocol) on Workers, where a client lives for one
 * request: `wrapper` opens it around the request and flushes it through `ctx.waitUntil` once the
 * response is sent, and `plugin`'s global `onError` captures an error whose status is 500 or more into
 * it, returning nothing so the app's `onError`, registered after, still writes the response. A 4xx is
 * the caller's mistake and is never sent. Without `SENTRY_DSN` there is no wrapper and the plugin
 * registers nothing. `options` is for tests (`beforeSend`, `transport`).
 */
export function createObservability(
  env: Record<string, unknown>,
  options: Partial<WorkersOptions> = {},
): { plugin: Elysia; wrapper: RequestWrapper | undefined } {
  const plugin = new Elysia({ name: "observability" });
  const dsn = text(env.SENTRY_DSN);
  if (!dsn) return { plugin, wrapper: undefined };

  // Concurrent requests share an isolate: each needs its own scope across `await`s, which
  // `wrapRequestHandler` does not set up by itself (`withSentry` does). The API runs with nodejs_compat.
  Sentry.setAsyncLocalStorageAsyncContextStrategy();
  const sentryOptions = { ...options, dsn, environment: text(env.SENTRY_ENVIRONMENT) };
  return {
    plugin: plugin.onError({ as: "global" }, ({ error }) => {
      if (httpStatus(error) >= 500) Sentry.captureException(error);
    }),
    wrapper: (request, _env, ctx, next) =>
      wrapRequestHandler(
        {
          options: sentryOptions,
          request,
          // Sentry only calls `waitUntil`; Workers' `passThroughOnException` is not part of the seam.
          context: { waitUntil: (promise) => ctx.waitUntil(promise), passThroughOnException() {} },
        },
        next,
      ),
  };
}

const observability = createObservability(await readRuntimeEnv());
if (observability.wrapper) wrapRequests(observability.wrapper);

/** What `apps/api` mounts; its request wrapper is registered with `api-runtime` at import. */
export const observabilityModule = observability.plugin;
