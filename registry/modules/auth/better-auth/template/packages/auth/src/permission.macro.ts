import { Elysia } from "elysia";
import type { Auth } from "./auth.config";
import type { RequiredPermissions } from "./permissions";

/** What the macro needs of the module that mounts it: the auth instance, built lazily. */
type ResolveAuth = () => Promise<{ auth: Auth }>;

/**
 * The macro behind `{ permission: { member: ["create"] } }` on a route: 401 without a session, 403 when
 * the role of the member in the session's active organization lacks a permission, the handler otherwise.
 * `auth.module.ts` and `libsql-auth.module.ts` both mount it, so the two variants answer alike.
 */
export function permissionMacroPlugin(resolveAuth: ResolveAuth) {
  return new Elysia({ name: "auth.permission" }).macro({
    permission: (permissions: RequiredPermissions) => ({
      async beforeHandle({ status, request }) {
        const { auth } = await resolveAuth();
        const { headers } = request;
        if (!(await auth.api.getSession({ headers }))) {
          return status(401);
        }
        // Better Auth answers 400 with no active organization and 401 to a non-member: neither is
        // allowed anything here.
        const allowed = await auth.api
          .hasPermission({ headers, body: { permissions } })
          .then(({ success }) => success)
          .catch(() => false);
        if (!allowed) {
          return status(403);
        }
      },
    }),
  });
}
