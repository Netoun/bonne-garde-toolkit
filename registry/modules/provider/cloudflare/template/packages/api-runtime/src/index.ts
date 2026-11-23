/**
 * The API's provider seam. Everything in `apps/api` that depends on where it runs lives here, so a
 * provider module swaps this package's contents and leaves
 * the app alone. This is the `cloudflare` variant: Elysia on Workers.
 *
 * The surface every variant exports:
 * - `runtimeOptions`: the constructor options of `new Elysia(...)` that differ per provider.
 * - `readRuntimeEnv()`: the environment record, read once by `apps/api`'s config.
 * - `clientIpHeaders`: the request headers that carry the client's address, in the order to read them.
 * - `serve(app)`: what `apps/api/src/index.ts` default-exports. Workers want a `{ fetch }` object,
 *   so that is what this variant returns; the `dockerfile` variant returns `{ port, fetch }`, which
 *   Bun serves by itself when that file is the entry.
 * - `wrapRequests(wrapper)`: registers a `RequestWrapper` that `serve` runs around every request it
 *   hands to the app, for a module that must see the request before the app does (error reporting
 *   that flushes after the response, ...). It returns the function that removes it. A module calls it
 *   at import, so `apps/api/src/index.ts` stays as it is.
 */
/// <reference types="@cloudflare/workers-types" />
import type { ElysiaConfig } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";

export const runtimeOptions: Pick<ElysiaConfig<"">, "adapter" | "aot"> = {
  adapter: CloudflareAdapter,
  // Workers forbid `new Function()`, which Elysia's ahead-of-time compiler relies on.
  aot: false,
};

/**
 * Cloudflare's edge sets `cf-connecting-ip` to the client's address on every request that reaches a
 * Worker, replacing a value the client sent. `x-forwarded-for`, which Better Auth reads by default,
 * is not set on Workers, so a rate limit left to its default sees no client at all.
 */
export const clientIpHeaders: readonly string[] = ["cf-connecting-ip"];

/**
 * `cloudflare:workers` is a specifier the Workers runtime provides, so a build for any other
 * provider fails on that line at bundle time — not at run time, which is why the `catch` below
 * cannot save it. That is the reason this read lives in the provider package and not in the app.
 */
export async function readRuntimeEnv(): Promise<Record<string, unknown>> {
  try {
    const cloudflare = await import("cloudflare:workers");
    return { ...cloudflare.env };
  } catch {
    // Bun and Node: the Workers specifier does not resolve at run time.
    return { ...process.env };
  }
}

/**
 * The part of the request's context a wrapper may use, the same on every provider. On Workers it is
 * the `ExecutionContext`: `waitUntil` keeps the isolate alive for the promise after the response.
 */
export interface RequestContext {
  waitUntil(promise: Promise<unknown>): void;
}

/**
 * Runs around the app for one request: `env` is the Workers env (bindings and vars), and `next()`
 * answers with the app's response, through the wrappers registered after this one.
 */
export type RequestWrapper = (
  request: Request,
  env: unknown,
  ctx: RequestContext,
  next: () => Promise<Response>,
) => Promise<Response>;

const wrappers: RequestWrapper[] = [];

/** Registers `wrapper`, outside the ones registered before it, and returns what removes it. */
export function wrapRequests(wrapper: RequestWrapper): () => void {
  wrappers.push(wrapper);
  return () => {
    const index = wrappers.indexOf(wrapper);
    if (index !== -1) wrappers.splice(index, 1);
  };
}

export function serve(app: {
  fetch: (request: Request, env: unknown, ctx: RequestContext) => Response | Promise<Response>;
}) {
  return {
    // The list is read per request: a module registers at import, which may come after `serve`.
    fetch(request: Request, env: unknown, ctx: RequestContext) {
      const handle = wrappers.reduceRight<() => Promise<Response>>(
        (next, wrapper) => () => wrapper(request, env, ctx, next),
        async () => app.fetch(request, env, ctx),
      );
      return handle();
    },
  };
}
