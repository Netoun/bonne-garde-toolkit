/** What the email module reads from the runtime's environment. The key is the only one it owns. */
export type EmailEnv = { RESEND_API_KEY: string };

/**
 * The email environment out of a plain record, as `readRuntimeEnv()` returns it. Pure: it reads no
 * runtime global. Throws, naming the key, when it is missing or empty: there is no stand-in outside
 * tests (see `runtime.ts`), so a project that never set it learns so at the first email and not
 * by sending nothing.
 */
export function resolveEmailEnv(source: Record<string, unknown>): EmailEnv {
  const key = source.RESEND_API_KEY;
  if (typeof key === "string" && key !== "") {
    return { RESEND_API_KEY: key };
  }
  throw new Error(
    "Missing required environment variable: RESEND_API_KEY. " +
      "Create a key at https://resend.com/api-keys and set it where the runtime reads its secrets " +
      "(`.dev.vars` for wrangler dev, the container's environment).",
  );
}
