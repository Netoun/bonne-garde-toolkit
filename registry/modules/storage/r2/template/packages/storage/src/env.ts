/** What storage reads from the runtime's environment. The public url is the only key it owns. */
export type StorageEnv = { R2_PUBLIC_URL: string };

/** Where the API serves a file by key. A stored media url is `<R2_PUBLIC_URL>/<key>`, so this path is fixed. */
const MEDIA_FILE_PATH = "/v1/media/file";

/** The origin of the local API: what `apps/api`'s own config takes for `API_URL` when nothing sets it. */
const LOCAL_API_URL = "http://localhost:5172";

/**
 * The storage environment out of a plain record, as `readRuntimeEnv()` returns it. Pure: it reads no
 * runtime global, and is given the `NODE_ENV` the code runs under. A public url the runtime holds is
 * used as it is. Without one:
 *
 * - `test` gets the local media route, so a test needs nothing set;
 * - `development`, which is what `wrangler dev` inlines, serves the files under the origin the API was
 *   given (`API_URL`), so a launcher that moves the API to another address needs no word of storage;
 * - anything else throws, `production` (what `wrangler deploy` inlines) and an unknown value alike. A
 *   media url is stored, so one derived where it should have been written down would outlive the deploy.
 */
export function resolveStorageEnv(
  source: Record<string, unknown>,
  options: { nodeEnv?: string } = {},
): StorageEnv {
  const publicUrl = source.R2_PUBLIC_URL;
  if (typeof publicUrl === "string" && publicUrl !== "") {
    return { R2_PUBLIC_URL: publicUrl };
  }
  if (options.nodeEnv === "test") {
    return { R2_PUBLIC_URL: `${LOCAL_API_URL}${MEDIA_FILE_PATH}` };
  }
  if (options.nodeEnv === "development") {
    const apiUrl =
      typeof source.API_URL === "string" && source.API_URL !== "" ? source.API_URL : LOCAL_API_URL;
    return { R2_PUBLIC_URL: `${apiUrl.replace(/\/+$/, "")}${MEDIA_FILE_PATH}` };
  }
  throw new Error(
    "Missing required environment variables: R2_PUBLIC_URL. " +
      "Please check your environment configuration.",
  );
}
