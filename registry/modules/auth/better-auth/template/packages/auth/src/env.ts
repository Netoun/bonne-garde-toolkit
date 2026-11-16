/** What auth reads from the runtime's environment. The secret is the only key it owns. */
export type AuthEnv = { BETTER_AUTH_SECRET: string };

/** What a test gets in place of a missing secret, so that no test needs a real one. */
const TEST_SECRET = "test-auth-secret-min-32-chars-long!!";

/**
 * The auth environment out of a plain record, as `readRuntimeEnv()` returns it. Pure: it reads no
 * runtime global. Throws when the secret is missing or empty, unless `test` is set, in which case
 * it gets a fixture.
 */
export function resolveAuthEnv(
  source: Record<string, unknown>,
  options: { test?: boolean } = {},
): AuthEnv {
  const secret = source.BETTER_AUTH_SECRET;
  if (typeof secret === "string" && secret !== "") {
    return { BETTER_AUTH_SECRET: secret };
  }
  if (options.test) {
    return { BETTER_AUTH_SECRET: TEST_SECRET };
  }
  throw new Error(
    "Missing required environment variables: BETTER_AUTH_SECRET. " +
      "Please check your environment configuration. `bun run auth:secret` generates one.",
  );
}
