import { Elysia } from "elysia";
import { and, eq, isNull } from "drizzle-orm";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { clientIpHeaders, readRuntimeEnv } from "{{SCOPE}}/api-runtime";
import { config } from "{{SCOPE}}/api/lib/app.config";
import { logger } from "{{SCOPE}}/api/lib/logger";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { allowedOrigins, applyCorsHeaders } from "{{SCOPE}}/api/lib/origins";
import { createDB } from "{{SCOPE}}/db";
import { readLibsql } from "{{SCOPE}}/db/libsql";
import { createAuth, type Auth, type AuthDatabase } from "./auth.config";
import { resolveAuthEnv } from "./env";
import { mailer } from "./mailer";
import { permissionMacroPlugin } from "./permission.macro";
import { member, organization, session as sessionTable } from "./schema";

/** An auth instance and the database it was built over. */
export type AuthContext = { auth: Auth; db: AuthDatabase };

/** How the routes get the auth context: a function, so that nothing is built at import time. */
export type ResolveAuth = () => Promise<AuthContext>;

/** The macro behind `{ auth: true }` on a route: the session, or 401. */
export function authMacroPlugin(resolveAuth: ResolveAuth) {
  return new Elysia({ name: "auth.macro" }).macro({
    auth: {
      async resolve({ status, request }) {
        const { auth, db } = await resolveAuth();
        // Try to get session from cookie
        const cookieHeader = request.headers.get("cookie");

        // Create headers object for better-auth
        const headers = new Headers();
        if (cookieHeader) {
          headers.set("cookie", cookieHeader);
        }

        const authSession = await auth.api.getSession({ headers });
        if (!authSession) {
          return status(401);
        }

        const { user, session } = authSession;

        // The active organization the session holds, unless it was marked deleted since: it scopes what
        // a route reads, and a deleted organization's data is not for its members to reach.
        let activeOrganizationId = session.activeOrganizationId;
        if (activeOrganizationId) {
          const [live] = await db
            .select({ id: organization.id })
            .from(organization)
            .where(and(eq(organization.id, activeOrganizationId), isNull(organization.deletedAt)))
            .limit(1);
          if (live === undefined) activeOrganizationId = null;
        }

        // If there is none, try to get the first one as default
        if (!activeOrganizationId) {
          // Query DB for user's first organization
          const userOrg = await db
            .select({
              orgId: organization.id,
            })
            .from(member)
            .leftJoin(organization, eq(member.organizationId, organization.id))
            .where(and(eq(member.userId, user.id), isNull(organization.deletedAt)))
            .limit(1);

          if (userOrg.length > 0 && userOrg[0]?.orgId) {
            activeOrganizationId = userOrg[0].orgId;
          }

          // Keep what was resolved in the session, so the next request starts from it
          await db
            .update(sessionTable)
            .set({ activeOrganizationId })
            .where(eq(sessionTable.id, session.id));
        }

        // Return enriched session with activeOrganizationId
        const enrichedSession = {
          ...session,
          activeOrganizationId,
        };
        return {
          user,
          session: enrichedSession,
        };
      },
    },
  });
}

/** The Better Auth handler mounted on the app, and the `auth` and `permission` macros beside it. */
export function authPlugin(resolveAuth: ResolveAuth) {
  return new Elysia({ name: "auth.module" })
    .use(authMacroPlugin(resolveAuth))
    .use(permissionMacroPlugin(resolveAuth))
    .mount(async (request) => {
      if (request.method === "OPTIONS") {
        return applyCorsHeaders(request, new Response(null, { status: 204 }));
      }
      const { auth } = await resolveAuth();
      return applyCorsHeaders(request, await auth.handler(request));
    });
}

async function buildContext(client: Awaited<ReturnType<typeof readLibsql>>): Promise<AuthContext> {
  const { BETTER_AUTH_SECRET, AUTH_SIGNUP } = resolveAuthEnv(await readRuntimeEnv(), {
    test: process.env.NODE_ENV === "test",
  });
  const db = createDB(client);
  return {
    db,
    auth: createAuth({
      db,
      secret: BETTER_AUTH_SECRET,
      baseURL: config.API_URL,
      appURL: config.SPA_URL,
      trustedOrigins: allowedOrigins(),
      clientIpHeaders,
      mailer,
      logger,
      signup: AUTH_SIGNUP,
    }),
  };
}

/**
 * One instance per libsql client: `readLibsql` opens one client per `DATA_DIR` and returns that same object
 * on every call, so a process builds one Better Auth instance and every request shares it.
 */
const contexts = new WeakMap<object, Promise<AuthContext>>();

async function resolveRuntimeAuth(): Promise<AuthContext> {
  const client = await readLibsql();
  let context = contexts.get(client);
  if (context === undefined) {
    const building = buildContext(client);
    contexts.set(client, building);
    // A failed build (a missing secret) is not remembered: the next request tries again.
    building.catch(() => contexts.delete(client));
    context = building;
  }
  return context;
}

export const authMacro = authMacroPlugin(resolveRuntimeAuth);
export const authModule = authPlugin(resolveRuntimeAuth);
