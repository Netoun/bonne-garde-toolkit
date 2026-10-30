import { createAuth } from "./auth.config";

/**
 * Entry for the Better Auth CLI (`bun run auth:generate`). The CLI reads `auth.options` from the
 * module it loads and exits on a factory such as `createAuth`, which `auth.config.ts` exports so
 * that nothing builds an instance at import time. This file builds one for the CLI alone: the
 * runtime's single instance is `authInstance` in `auth.service.ts`.
 *
 * The script runs with `NODE_ENV=test`: `app.config.ts` then fills the three required secrets with
 * fixtures instead of exiting, and generating a schema needs no real one.
 */
export const auth = createAuth();
