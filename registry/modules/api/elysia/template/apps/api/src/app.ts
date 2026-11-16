import "elysia";
import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { runtimeOptions } from "{{SCOPE}}/api-runtime";
import { branding } from "{{SCOPE}}/config";
import { originAllowed } from "{{SCOPE}}/api/lib/origins";

export const app = new Elysia(runtimeOptions)
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
  // Insertion point for the modules that plug into the API (db, auth, storage, ...). A module adds
  // one `.use(<module>)` here, after the last `.use()` above and before the routes below, through
  // the `ts.elysiaUse` patch (spec 060) keyed on `app`: it owns `elysia[app].use[<module>]` and
  // reformats nothing. Keep `app` exported under that name, built from `new Elysia(runtimeOptions)`.
  .get("/health", () => ({ status: "ok", timestamp: Date.now() }));

export type App = typeof app;
