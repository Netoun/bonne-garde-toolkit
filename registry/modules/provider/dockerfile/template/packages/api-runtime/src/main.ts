/**
 * What the container starts (the Dockerfile's `CMD`): the API's entry when the project has one, which
 * serves the built SPA beside it, else the SPA alone, its routes answered with `index.html`, `/health`
 * with ok for the image's healthcheck, and any other request with 404. The API's home is `apps/api`
 * (035); nothing else here names a module.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";
import { serve } from "./index";

const API_ENTRY = join(import.meta.dirname, "../../../apps/api/src/index.ts");

if (existsSync(API_ENTRY)) {
  await import(API_ENTRY);
} else {
  await serve({
    fetch: (request) =>
      new URL(request.url).pathname === "/health"
        ? Response.json({ status: "ok" })
        : new Response("Not found", { status: 404 }),
  });
}
