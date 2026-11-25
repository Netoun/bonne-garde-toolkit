/** Who may create an account: anyone (`open`), or only whoever holds a signup code or an organization invitation (`invite`). */
export type AuthSignup = "open" | "invite";

/** What auth reads from the runtime's environment. */
export type AuthEnv = { BETTER_AUTH_SECRET: string; AUTH_SIGNUP: AuthSignup };

/** What a test gets in place of a missing secret, so that no test needs a real one. */
const TEST_SECRET = "test-auth-secret-min-32-chars-long!!";

/**
 * The auth environment out of a plain record, as `readRuntimeEnv()` returns it. Pure: it reads no
 * runtime global. Throws when the secret is missing or empty, unless `test` is set, in which case
 * it gets a fixture, and when `AUTH_SIGNUP` is set to anything but `open` or `invite`: a gate that
 * misreads its setting must not fall open.
 */
export function resolveAuthEnv(
  source: Record<string, unknown>,
  options: { test?: boolean } = {},
): AuthEnv {
  const signup = source.AUTH_SIGNUP === undefined ? "open" : source.AUTH_SIGNUP;
  if (signup !== "open" && signup !== "invite") {
    throw new Error('Invalid environment variable: AUTH_SIGNUP must be "open" or "invite".');
  }
  const secret = source.BETTER_AUTH_SECRET;
  if (typeof secret === "string" && secret !== "") {
    return { BETTER_AUTH_SECRET: secret, AUTH_SIGNUP: signup };
  }
  if (options.test) {
    return { BETTER_AUTH_SECRET: TEST_SECRET, AUTH_SIGNUP: signup };
  }
  throw new Error(
    "Missing required environment variables: BETTER_AUTH_SECRET. " +
      "Please check your environment configuration. `vp run auth:secret` generates one.",
  );
}
