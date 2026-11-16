import { clientIpHeaders } from "{{SCOPE}}/api-runtime";
import { bindD1 } from "{{SCOPE}}/db/d1";
import { createDB } from "{{SCOPE}}/db";
import { createAuth } from "./auth.config";
import { resolveAuthEnv } from "./env";
import { mailer } from "./mailer";

/**
 * Entry for the Better Auth CLI (`bun run auth:generate`). The CLI reads `auth.options` from the
 * module it loads and exits on a factory such as `createAuth`, which `auth.config.ts` exports so
 * that nothing builds an instance at import time. This file builds one for the CLI alone, over a
 * database that is never queried and a fixture secret: generating a schema needs no real ones.
 * The runtime's instance is the one `auth.module.ts` builds on the first request.
 */
export const auth = createAuth({
  db: createDB(bindD1({})),
  secret: resolveAuthEnv({}, { test: true }).BETTER_AUTH_SECRET,
  baseURL: "http://localhost:5172",
  appURL: "http://localhost:5173",
  trustedOrigins: [],
  clientIpHeaders,
  mailer,
  logger: { info() {}, warn() {}, error() {} },
});
