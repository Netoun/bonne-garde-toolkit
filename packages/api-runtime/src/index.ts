/**
 * The API's provider seam. Everything in `apps/api` that depends on where it runs lives here, so a
 * provider module (`docs/specs/035-module-registry.md`) swaps this package's contents and leaves
 * the app alone. This is the `cloudflare` variant: Elysia on Workers.
 *
 * The surface every variant exports:
 * - `runtimeOptions`: the constructor options of `new Elysia(...)` that differ per provider.
 * - `readRuntimeEnv()`: the environment record, read once by `apps/api`'s config.
 * - `serve(app)`: what `apps/api/src/index.ts` default-exports. Workers want a `{ fetch }` object,
 *   so that is what this variant returns; the `dockerfile` variant returns `{ port, fetch }`, which
 *   Bun serves by itself when that file is the entry.
 */
import type { ElysiaConfig } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";

export const runtimeOptions: Pick<ElysiaConfig<"">, "adapter" | "aot"> = {
  adapter: CloudflareAdapter,
  // Workers forbid `new Function()`, which Elysia's ahead-of-time compiler relies on.
  aot: false,
};

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

export function serve(app: {
  fetch: (request: Request, env: unknown, ctx: unknown) => Response | Promise<Response>;
}) {
  return {
    fetch(request: Request, env: unknown, ctx: unknown) {
      return app.fetch(request, env, ctx);
    },
  };
}
