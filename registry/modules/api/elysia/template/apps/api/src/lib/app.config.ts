import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
import Type from "typebox";
import { Default, Check } from "typebox/value";
import type { Env } from "./env";

// Only string vars and secrets — bindings (DB, BUCKET) are injected at request time by the
// runtime and must NOT be checked when this module loads.
export const appEnvSchema = Type.Object({
  SPA_URL: Type.String({ default: "http://localhost:5173" }),
  SSR_URL: Type.String({ default: "http://localhost:5174" }),
  API_URL: Type.String({ default: "http://localhost:5172" }),
});

// The shell requires no variable, so there is no fixture to fill.
const testDefaults: Record<string, string> = {};

function missingRequired(resolved: Record<string, unknown>): string[] {
  const properties = appEnvSchema.properties as Record<string, { default?: unknown }>;
  return Object.keys(properties).filter((key) => {
    if ("default" in properties[key]) return false;
    const value = resolved[key];
    return value === undefined || value === null || value === "";
  });
}

/**
 * Builds the config from a plain record. Pure: it reads no runtime global and leaves `source`
 * untouched, because `Default()` writes into the object it is handed — writing into `process.env`
 * would coerce every value back to a string.
 *
 * Throws on a missing required var unless `test` is set, in which case it gets its `testDefaults`
 * fixture.
 */
export function resolveAppConfig(
  source: Record<string, unknown>,
  options: { test?: boolean } = {},
): Env {
  const resolved = Default(appEnvSchema, { ...source }) as Record<string, unknown>;

  if (!Check(appEnvSchema, resolved)) {
    if (!options.test) {
      throw new Error(
        `Missing required environment variables: ${missingRequired(resolved).join(", ")}. ` +
          "Please check your environment configuration.",
      );
    }
    for (const [key, value] of Object.entries(testDefaults)) {
      if (!resolved[key]) {
        resolved[key] = value;
      }
    }
  }

  return resolved as unknown as Env;
}

export const config = resolveAppConfig(await readRuntimeEnv(), {
  test: process.env.NODE_ENV === "test",
});
