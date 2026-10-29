import { Elysia } from "elysia";
import { config } from "@acme/api/lib/app.config";
import { authInstance, authService } from "./auth.service";
import { AuthMacro } from "./auth.macro";
import { dbService } from "@acme/api/modules/db/db.service";

function withCors(req: Request, response: Response): Response {
  const origin = req.headers.get("origin") ?? "";
  const allowed = [config.BO_URL, config.PLAYER_URL];
  if (!allowed.includes(origin)) return response;

  const res = new Response(response.body, response);
  res.headers.set("Access-Control-Allow-Origin", origin);
  res.headers.set("Access-Control-Allow-Credentials", "true");
  res.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS, PATCH");
  res.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return res;
}

export const authModule = new Elysia({ name: "auth.module" })
  .use(authService)
  .use(AuthMacro)
  .use(dbService)
  .mount(async (req) => {
    if (req.method === "OPTIONS") {
      return withCors(req, new Response(null, { status: 204 }));
    }
    return withCors(req, await authInstance.handler(req));
  });
