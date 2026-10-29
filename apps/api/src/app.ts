import "elysia";
import { Elysia } from "elysia";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { branding } from "@acme/config";
import { originAllowed } from "@acme/api/lib/origins";
import { dbModule } from "@acme/api/modules/db/db.module";
import { authModule } from "@acme/api/modules/auth/auth.module";
import { mediaModule } from "@acme/api/modules/media/media.module";

export const app = new Elysia({ aot: false, adapter: CloudflareAdapter })
  .use(
    cors({
      origin: ({ headers }) => originAllowed(headers.get("origin") ?? ""),
      credentials: true,
    }),
  )
  .use(
    openapi({
      documentation: {
        info: {
          title: `${branding.displayName} API`,
          description: `API for the ${branding.displayName} platform`,
          version: "0.0.1",
        },
      },
    }),
  )
  .use(dbModule)
  .use(authModule)
  .group("/v1", (app) => {
    return app.use(mediaModule);
  })
  .get("/health", () => ({ status: "ok", timestamp: Date.now() }));

export type App = typeof app;
