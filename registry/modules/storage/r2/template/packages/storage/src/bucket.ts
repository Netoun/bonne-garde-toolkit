/// <reference types="@cloudflare/workers-types" />
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";

/** The `binding` of the `r2_buckets` entry this module writes into the Worker's `wrangler.jsonc`. */
export const R2_BINDING = "BUCKET";

/** The shape every R2 bucket binding has, which is what tells it from an environment variable of the same name. */
function isR2Bucket(value: unknown): value is R2Bucket {
  return (
    typeof value === "object" &&
    value !== null &&
    "put" in value &&
    typeof value.put === "function" &&
    "get" in value &&
    typeof value.get === "function" &&
    "delete" in value &&
    typeof value.delete === "function" &&
    "head" in value &&
    typeof value.head === "function" &&
    "list" in value &&
    typeof value.list === "function"
  );
}

/**
 * The R2 binding of `env`, or `undefined` where the runtime has none (a unit test, `bun run`, a
 * Worker deployed without the bucket). The media service answers `BUCKET_NOT_CONFIGURED` for an
 * upload or a file then, and still deletes the record of a media: a missing bucket is a state it
 * reports, not one that crashes the Worker at import.
 */
export function bindR2(env: Record<string, unknown>): R2Bucket | undefined {
  const binding = env[R2_BINDING];
  return isR2Bucket(binding) ? binding : undefined;
}

/** The R2 binding of the runtime the code runs on, read through the provider's `readRuntimeEnv`. */
export async function readR2(): Promise<R2Bucket | undefined> {
  return bindR2(await readRuntimeEnv());
}
