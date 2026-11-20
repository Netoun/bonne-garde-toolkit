/** Where the API serves a file by key. A stored media url is `<origin>/v1/media/file/<key>`, so this path is fixed. */
const MEDIA_FILE_PATH = "/v1/media/file";

/** The origin of the local API: what `provider/dockerfile` takes for `APP_URL` when nothing sets it. */
const LOCAL_APP_URL = "http://localhost:5172";

function text(value: unknown): string | undefined {
  return typeof value === "string" && value !== "" ? value : undefined;
}

/**
 * The url the API serves its files under, out of a plain record, as `readRuntimeEnv()` returns it.
 * Pure. The origin is `APP_URL`, which `provider/dockerfile` owns: the API and the front share it. A
 * record without one has the `API_URL` the provider derives from it, and then the local origin. The
 * module owns no key of its own.
 */
export function resolvePublicUrl(source: Record<string, unknown>): string {
  const origin = text(source.APP_URL) ?? text(source.API_URL) ?? LOCAL_APP_URL;
  return `${origin.replace(/\/+$/, "")}${MEDIA_FILE_PATH}`;
}
