import { Elysia } from "elysia";
import { applyCorsHeaders } from "@acme/api/lib/origins";
import { authInstance, authService } from "./auth.service";
import { AuthMacro } from "./auth.macro";
import { dbService } from "@acme/api/modules/db/db.service";

export const authModule = new Elysia({ name: "auth.module" })
  .use(authService)
  .use(AuthMacro)
  .use(dbService)
  .mount(async (req) => {
    if (req.method === "OPTIONS") {
      return applyCorsHeaders(req, new Response(null, { status: 204 }));
    }
    return applyCorsHeaders(req, await authInstance.handler(req));
  });
