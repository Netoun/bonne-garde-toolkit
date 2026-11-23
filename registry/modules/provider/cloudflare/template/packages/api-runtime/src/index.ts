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
 * - `registerUpgrade(prefix, handler)`: claims the WebSocket upgrades under a path prefix, before the
 *   app sees them (Elysia rebuilds a 101 response, which Workers reject). Here the handler is
 *   fetch-style and gets the Worker's `env` and `ctx`; the `dockerfile` variant takes crossws hooks.
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

type FetchHandler = (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;

const upgrades = new Map<string, FetchHandler>();

/**
 * Hands the WebSocket upgrades whose path is `prefix` or under it (`/ws/rooms`, `/ws/rooms/abc`, not
 * `/ws/roomsx`) to `handler`, called at module load by the package that owns them. Returns the
 * function that takes the registration back.
 */
export function registerUpgrade(prefix: string, handler: FetchHandler): () => void {
  if (upgrades.has(prefix))
    throw new Error(`An upgrade handler is already registered for ${prefix}`);
  upgrades.set(prefix, handler);
  return () => upgrades.delete(prefix);
}

function upgradeHandler(request: Request): FetchHandler | undefined {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return undefined;
  const { pathname } = new URL(request.url);
  for (const [prefix, handler] of upgrades) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return handler;
  }
  return undefined;
}

export function serve(app: { fetch: FetchHandler }) {
  return {
    fetch(request: Request, env: unknown, ctx: unknown) {
      const upgrade = upgradeHandler(request);
      return upgrade ? upgrade(request, env, ctx) : app.fetch(request, env, ctx);
    },
  };
}
