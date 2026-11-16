import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { and, eq, isNull } from "drizzle-orm";
import type { BaseSQLiteDatabase } from "drizzle-orm/sqlite-core";
import { AUTH_BASE_PATH } from "./base-path";
import type { AuthMailer } from "./mailer";
import { hashPassword, verifyPassword } from "./password";
import * as schema from "./schema";

const { member, organization: orgTable } = schema;

/** A Drizzle SQLite database, whichever driver is behind it: D1 in a Worker, `bun:sqlite` in a test. */
export type AuthDatabase = BaseSQLiteDatabase<"sync" | "async", unknown, Record<string, unknown>>;

/** The log calls auth makes; `{{SCOPE}}/api/lib/logger` has this shape. */
export type AuthLogger = {
  info(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
  error(message: string, error?: unknown, context?: Record<string, unknown>): void;
};

export type AuthOptions = {
  db: AuthDatabase;
  secret: string;
  /** The origin the API answers on (`API_URL`). */
  baseURL: string;
  /** The origin of the front-end whose `/auth/*` pages the links in emails open (`SPA_URL`). */
  appURL: string;
  /** The origins allowed to call the API with credentials. */
  trustedOrigins: string[];
  /**
   * The request headers that carry the client's address, in the order they are read: the provider's
   * `clientIpHeaders`. The rate limit keys its buckets on that address.
   */
  clientIpHeaders: readonly string[];
  mailer: AuthMailer;
  logger: AuthLogger;
};

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export function createAuth({
  db,
  secret,
  baseURL,
  appURL,
  trustedOrigins,
  clientIpHeaders,
  mailer,
  logger,
}: AuthOptions) {
  // `https` in production, plain `http` on localhost, where a Secure cookie would be dropped.
  const secureCookies = baseURL.startsWith("https://");

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema,
      // D1 has no interactive transactions (only `batch`), and `bun:sqlite` rejects an async
      // callback in one. Better Auth's default is off; it is written out so that stays true.
      transaction: false,
    }),
    secret,
    baseURL,
    basePath: AUTH_BASE_PATH,
    trustedOrigins,
    // Explicit on purpose: every value below equals Better Auth's production default for this
    // baseURL, written out so that a default change upstream cannot weaken auth silently.
    advanced: {
      useSecureCookies: secureCookies,
      // Better Auth reads `x-forwarded-for` alone unless told otherwise, and Workers do not set it:
      // every client would then share one rate-limit bucket. The provider says where the address is.
      ipAddress: { ipAddressHeaders: [...clientIpHeaders] },
      disableCSRFCheck: false,
      // Better Auth turns the origin check off under NODE_ENV=test when this is unset.
      // Setting it keeps the tests running with the same protection as production.
      disableOriginCheck: false,
      // `sameSite: "lax"` holds while the fronts and the API share a registrable domain
      // (`spa.`, `ssr.`, `api.` on one apex, or localhost). Fronts on another site
      // (e.g. `*.pages.dev` against the API) need `sameSite: "none"` with `secure: true`.
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite: "lax",
        secure: secureCookies,
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      password: {
        hash: hashPassword,
        verify: ({ password, hash }) => verifyPassword(password, hash),
      },
      sendResetPassword: async ({ user, token }) => {
        try {
          // The SPA page that takes the token as a query param (the `/auth/reset-password` route).
          const resetUrl = new URL("/auth/reset-password", appURL);
          resetUrl.searchParams.set("token", token);

          await mailer.sendPasswordReset({
            userId: user.id,
            to: user.email,
            name: user.name || user.email,
            url: resetUrl.toString(),
          });
        } catch (error) {
          logger.error("Failed to send reset password email", error, {
            scope: "auth",
            event: "send_reset_password_email",
            userId: user.id,
          });
          throw error;
        }
      },
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, token }) => {
        try {
          // The SPA page that takes the token as a query param (the `/auth/verify-email` route).
          const verificationUrl = new URL("/auth/verify-email", appURL);
          verificationUrl.searchParams.set("token", token);

          await mailer.sendVerificationEmail({
            userId: user.id,
            to: user.email,
            name: user.name || user.email,
            url: verificationUrl.toString(),
          });
        } catch (error) {
          logger.error("Failed to send verification email", error, {
            scope: "auth",
            event: "send_verification_email",
            userId: user.id,
          });
          throw error;
        }
      },
    },
    databaseHooks: {
      // Hook: Create default organization after user signup
      user: {
        create: {
          after: async (user) => {
            try {
              const orgId = crypto.randomUUID();
              const orgName = "Personal";
              const orgSlug = generateSlug(orgName);

              // Create default organization
              await db.insert(orgTable).values({
                id: orgId,
                name: orgName,
                slug: orgSlug,
                createdAt: new Date(),
                settings: {},
              });

              // Add user as owner
              await db.insert(member).values({
                id: crypto.randomUUID(),
                organizationId: orgId,
                userId: user.id,
                role: "owner",
                createdAt: new Date(),
              });

              logger.info("Created default organization", {
                scope: "auth",
                event: "default_org_created",
                userId: user.id,
                orgId,
                orgName,
              });
            } catch (error) {
              logger.error("Failed to create default organization", error, {
                scope: "auth",
                event: "default_org_creation_failed",
                userId: user.id,
              });
              // Don't throw - user creation should not fail if org creation fails
            }
          },
        },
      },
      // Hook: Set active organization on session creation (login)
      session: {
        create: {
          before: async (session) => {
            try {
              // Get first organization for this user
              const userOrg = await db
                .select({
                  orgId: orgTable.id,
                })
                .from(member)
                .leftJoin(orgTable, eq(member.organizationId, orgTable.id))
                .where(and(eq(member.userId, session.userId), isNull(orgTable.deletedAt)))
                .limit(1);

              if (userOrg.length > 0 && userOrg[0]?.orgId) {
                const newSession = {
                  ...session,
                  activeOrganizationId: userOrg[0].orgId,
                };
                logger.info("Auto-setting active organization", {
                  scope: "auth",
                  event: "session_org_set",
                  userId: session.userId,
                  orgId: userOrg[0].orgId,
                });
                return {
                  data: newSession,
                };
              }

              return { data: session };
            } catch (error) {
              logger.error("Failed to set active organization", error, {
                scope: "auth",
                event: "session_org_set_failed",
                userId: session.userId,
              });
              return { data: session };
            }
          },
        },
      },
    },
    hooks: {
      // `organization.deletedAt` is the app's soft delete, and Better Auth's organization endpoints do
      // not know it. Making a deleted organization the active one is refused before it changes the
      // session; fetching it, and listing it, are filtered after.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== "/organization/set-active") return;
        const { organizationId, organizationSlug } = ctx.body ?? {};
        const where =
          typeof organizationId === "string"
            ? { field: "id", value: organizationId }
            : typeof organizationSlug === "string"
              ? { field: "slug", value: organizationSlug }
              : null;
        if (where === null) return;
        const found = await ctx.context.adapter.findOne<{ deletedAt: Date | null }>({
          model: "organization",
          where: [where],
        });
        if (found?.deletedAt) {
          throw new APIError("NOT_FOUND", { message: "Organization not found" });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        const returned = ctx.context.returned;
        if (ctx.path === "/organization/list" && Array.isArray(returned)) {
          return ctx.json(
            returned.filter((entry: { deletedAt?: Date | null }) => !entry.deletedAt),
          );
        }
        if (
          ctx.path === "/organization/get-full-organization" &&
          typeof returned === "object" &&
          returned !== null &&
          "deletedAt" in returned &&
          returned.deletedAt
        ) {
          throw new APIError("NOT_FOUND", { message: "Organization not found" });
        }
      }),
    },
    // Rate limiting — default storage is in-memory (per-isolate on Workers).
    // Can be moved to secondary storage (e.g. KV) later for cross-isolate consistency.
    rateLimit: {
      enabled: true,
      window: 60, // 60-second window
      max: 100, // generous global default
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        // Matched on the path Better Auth serves, relative to the base path: this one was
        // `/forget-password` until 1.6 renamed the endpoint, and a rule that matches nothing is silent.
        "/request-password-reset": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    plugins: [
      organization({
        // `schema.ts` is generated by `bun run auth:generate` from these options, so a column
        // declared only there is dropped by the next regeneration. The session hook above and
        // `auth.module.ts` filter on `deletedAt`. `input: false` keeps both server-only: the
        // plugin's `create` and `update` endpoints accept every declared field otherwise.
        schema: {
          organization: {
            additionalFields: {
              deletedAt: { type: "date", required: false, input: false },
              settings: { type: "json", required: false, input: false },
            },
          },
        },
      }),
    ],
  });
}

export type Auth = ReturnType<typeof createAuth>;
