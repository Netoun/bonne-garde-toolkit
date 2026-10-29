import Type from "typebox";
import { Default, Check } from "typebox/value";
import type { Env } from "./env";

// Import cloudflare workers env dynamically to support both
// production (Workers runtime) and test (Node/Bun) environments
let workersEnv: Record<string, unknown> = {};

try {
  // Try to import from cloudflare:workers (only available in Workers runtime)
  const cloudflare = await import("cloudflare:workers");
  workersEnv = cloudflare.env as Record<string, unknown>;
} catch {
  // In test environment, use process.env or globalThis
  workersEnv = (process.env as Record<string, unknown>) || {};
}

const isTest = process.env.NODE_ENV === "test";

// Only validate string vars/secrets — CF bindings (DB, BUCKET) are injected at
// request time by the Workers runtime and must NOT be checked at module load.
const appEnvSchema = Type.Object({
  SPA_URL: Type.String({ default: "http://localhost:5173" }),
  SSR_URL: Type.String({ default: "http://localhost:5174" }),
  API_URL: Type.String({ default: "http://localhost:5172" }),
  R2_PUBLIC_URL: Type.String(),
  BETTER_AUTH_SECRET: Type.String(),
  RESEND_API_KEY: Type.String(),
});

// Apply defaults
const withDefaults = Default(appEnvSchema, workersEnv);

// Validate synchronously at import time - crash on missing required vars
if (!Check(appEnvSchema, withDefaults)) {
  const testDefaults: Record<string, string> = {
    R2_PUBLIC_URL: "http://localhost:5172/v1/media/file",
    BETTER_AUTH_SECRET: "test-auth-secret-min-32-chars-long!!",
    RESEND_API_KEY: "test-resend-api-key",
  };

  if (isTest) {
    // In test mode, apply test defaults for missing vars
    for (const [key, value] of Object.entries(testDefaults)) {
      if (!(key in workersEnv) || !workersEnv[key]) {
        workersEnv[key] = value;
      }
    }
  } else {
    // In production, crash immediately with clear message
    const missing = Object.keys(appEnvSchema.properties).filter((key) => {
      const hasDefault =
        "default" in (appEnvSchema.properties as Record<string, { default?: unknown }>)[key];
      const value = workersEnv[key];
      return !hasDefault && (value === undefined || value === null || value === "");
    });
    throw new Error(
      `Missing required environment variables: ${missing.join(", ")}. ` +
        "Please check your environment configuration.",
    );
  }
}

export const config = workersEnv as unknown as Env;
