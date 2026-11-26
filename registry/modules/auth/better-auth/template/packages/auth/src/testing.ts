import { createTestDb } from "{{SCOPE}}/db/testing";
import { createAuth, type AuthOptions } from "./auth.config";
import { AUTH_BASE_PATH } from "./client";
import { resolveAuthEnv } from "./env";
import type { AuthEmail, AuthInvitationEmail, AuthMailer } from "./mailer";
import * as schema from "./schema";

/** The origins a test serves the API and the front-end on. */
export const TEST_API_URL = "http://api.test";
export const TEST_APP_URL = "http://spa.test";

/**
 * The header a test instance reads the client's address from unless the test names another: it is
 * what a provider's `clientIpHeaders` would give, and Better Auth's rate limit keys a bucket on it.
 * Its memory store is shared by every instance in the process, so each instance gets an address of
 * its own to start from.
 */
export const TEST_CLIENT_IP_HEADER = "x-test-client-ip";

let instances = 0;

/** A verification or reset email the mailer was asked to send, in the order it was asked; invitations are kept apart. */
export type SentEmail = AuthEmail & { kind: "verification" | "password_reset" };

type TestAuthOverrides = Partial<
  Pick<AuthOptions, "trustedOrigins" | "clientIpHeaders" | "logger" | "providers"> & {
    /**
     * Replaces the methods of the test mailer it names and keeps the others, so that a test can
     * swap `sendInvitation` and still sign its users in through the emails the test mailer keeps.
     */
    mailer: Partial<AuthMailer>;
  }
>;

/** The database `createTestDb` gives for a schema: real SQLite, which is what D1 is. */
type TestDatabase<TSchema extends Record<string, unknown>> = Awaited<
  ReturnType<typeof createTestDb<TSchema>>
>;

/**
 * A Better Auth instance over a fresh in-memory SQLite database that has the auth tables, and a
 * mailer that keeps what it is asked to send instead of sending it. Nothing is mocked: the
 * database is the one D1 is, and the requests go through the handler the API mounts.
 *
 * A module whose tables point at auth's (a `medias` row has an author) passes them as `tables`: they
 * are created beside auth's in the same database, which is `db`, and `signIn` is how its tests get a
 * session over it.
 */
export async function createTestAuth(
  overrides?: TestAuthOverrides,
): Promise<TestAuth<typeof schema>>;
export async function createTestAuth<TTables extends Record<string, unknown>>(
  overrides: TestAuthOverrides,
  tables: TTables,
): Promise<TestAuth<typeof schema & TTables>>;
export async function createTestAuth(overrides: TestAuthOverrides = {}, tables = {}) {
  return startTestAuth(overrides, await createTestDb({ ...schema, ...tables }));
}

export type TestAuth<TSchema extends Record<string, unknown>> = Awaited<
  ReturnType<typeof startTestAuth<TSchema>>
>;

async function startTestAuth<TSchema extends Record<string, unknown>>(
  overrides: TestAuthOverrides,
  db: TestDatabase<TSchema>,
) {
  // A client address of this instance's own, so that no test spends another's rate limit.
  instances += 1;
  const clientIp = `10.${Math.floor(instances / 250)}.${instances % 250}.1`;
  const sent: SentEmail[] = [];
  const invitations: AuthInvitationEmail[] = [];
  const mailer: AuthMailer = {
    async sendVerificationEmail(email) {
      sent.push({ kind: "verification", ...email });
    },
    async sendPasswordReset(email) {
      sent.push({ kind: "password_reset", ...email });
    },
    async sendInvitation(email) {
      invitations.push(email);
    },
    ...overrides.mailer,
  };
  const auth = createAuth({
    db,
    secret: resolveAuthEnv({}, { test: true }).BETTER_AUTH_SECRET,
    baseURL: TEST_API_URL,
    appURL: TEST_APP_URL,
    trustedOrigins: [TEST_APP_URL],
    clientIpHeaders: [TEST_CLIENT_IP_HEADER],
    logger: { info() {}, warn() {}, error() {} },
    ...overrides,
    mailer,
  });
  const clientIpHeader =
    (overrides.clientIpHeaders ?? [TEST_CLIENT_IP_HEADER])[0] ?? TEST_CLIENT_IP_HEADER;

  /** A request to the auth handler, from the front-end's origin. */
  function call(
    path: string,
    init: {
      method?: string;
      body?: unknown;
      cookie?: string;
      /** The client's address; this instance's own when omitted. */
      ip?: string;
      headers?: Record<string, string>;
    } = {},
  ): Promise<Response> {
    const {
      method = init.body === undefined ? "GET" : "POST",
      body,
      cookie,
      ip = clientIp,
      headers,
    } = init;
    return auth.handler(
      new Request(`${TEST_API_URL}${AUTH_BASE_PATH}${path}`, {
        method,
        headers: {
          origin: TEST_APP_URL,
          [clientIpHeader]: ip,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
          ...(cookie === undefined ? {} : { cookie }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      }),
    );
  }

  /** Signs a user up, opens the link of the email it was sent, and signs in: the cookie of that session. */
  async function signIn(email: string, password = "correct horse battery staple") {
    const signUp = await call("/sign-up/email", { body: { email, password, name: email } });
    if (!signUp.ok) {
      throw new Error(`sign-up answered ${signUp.status}: ${await signUp.text()}`);
    }
    const mail = sent.findLast((message) => message.to === email);
    const token = mail === undefined ? null : new URL(mail.url).searchParams.get("token");
    if (token === null) {
      throw new Error(`no verification email was sent to ${email}`);
    }
    await auth.api.verifyEmail({ query: { token } });
    const response = await call("/sign-in/email", { body: { email, password } });
    if (!response.ok) {
      throw new Error(`sign-in answered ${response.status}: ${await response.text()}`);
    }
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(";")[0])
      .join("; ");
  }

  return { auth, db, sent, invitations, call, signIn };
}
