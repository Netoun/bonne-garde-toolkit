import { betterAuth } from "better-auth";
import { organization } from "better-auth/plugins";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { eq, and, isNull } from "drizzle-orm";
import { createDB } from "@acme/api/modules/db/db.client";
import {
  authSchema,
  member,
  organization as orgTable,
} from "@acme/api/modules/db/schemas/db.auth-schema";
import { createResendClient, sendEmail } from "@acme/api/lib/email";
import { VerifyEmailEmail, ResetPasswordEmail } from "@acme/emails";
import { config } from "@acme/api/lib/app.config";
import { allowedOrigins } from "@acme/api/lib/origins";
import { logger } from "@acme/api/lib/logger";
import { hashPassword, verifyPassword } from "@acme/api/lib/crypto/password";

function generateSlug(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

export function createAuth() {
  const db = createDB(config.DB);
  const resend = createResendClient(config.RESEND_API_KEY);
  // `https` in production, plain `http` on localhost, where a Secure cookie would be dropped.
  const secureCookies = config.API_URL.startsWith("https://");

  return betterAuth({
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: authSchema,
    }),
    secret: config.BETTER_AUTH_SECRET,
    baseURL: config.API_URL,
    basePath: "/auth",
    trustedOrigins: allowedOrigins(),
    // Explicit on purpose: every value below equals Better Auth's production default for this
    // baseURL, written out so that a default change upstream cannot weaken auth silently.
    advanced: {
      useSecureCookies: secureCookies,
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
          // Build SPA URL with token as query param (matches /auth/reset-password route)
          const resetUrl = new URL("/auth/reset-password", config.SPA_URL);
          resetUrl.searchParams.set("token", token);

          await sendEmail({
            resend,
            to: user.email,
            subject: "Reset your password",
            react: ResetPasswordEmail({
              name: user.name || user.email,
              resetUrl: resetUrl.toString(),
            }),
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
          // Build SPA URL with token as query param (matches /auth/verify-email route)
          const verificationUrl = new URL("/auth/verify-email", config.SPA_URL);
          verificationUrl.searchParams.set("token", token);

          await sendEmail({
            resend,
            to: user.email,
            subject: "Verify your email address",
            react: VerifyEmailEmail({
              name: user.name || user.email,
              verificationUrl: verificationUrl.toString(),
            }),
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
    // Rate limiting — default storage is in-memory (per-isolate on Workers).
    // Can be moved to secondary storage (e.g. KV) later for cross-isolate consistency.
    rateLimit: {
      enabled: true,
      window: 60, // 60-second window
      max: 100, // generous global default
      customRules: {
        "/sign-in/email": { window: 60, max: 10 },
        "/sign-up/email": { window: 60, max: 5 },
        "/forget-password": { window: 60, max: 5 },
        "/reset-password": { window: 60, max: 5 },
      },
    },
    plugins: [
      organization({
        // `db.auth-schema.ts` is generated by `bun run auth:generate` from these options, so a
        // column declared only there is dropped by the next regeneration. `auth.macro.ts` and the
        // session hook above filter on `deletedAt`. `input: false` keeps both server-only: the
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
