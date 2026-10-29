/**
 * The provider seam: where the environment record comes from.
 *
 * `cloudflare:workers` is a specifier the Workers runtime provides, so a build for any other
 * provider fails on this line at bundle time — not at run time, which is why the `catch` below
 * cannot save it. That is the whole reason this read lives alone in one file: a provider variant
 * replaces this file and nothing else (`docs/specs/035-module-registry.md`).
 *
 * Spec 035's package-dedicated seam rule forbids module source inside an app's own `src`, so this
 * belongs in a package once the `cloudflare` and `dockerfile` modules ship. It sits here until
 * then because spec 080 deletes `apps/api` once its module is green.
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
