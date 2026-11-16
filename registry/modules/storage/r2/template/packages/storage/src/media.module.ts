import { Elysia } from "elysia";
// `bg add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
// oxfmt-ignore
import { authMacro } from "{{SCOPE}}/auth";
// oxfmt-ignore
import { createDB } from "{{SCOPE}}/db";
// oxfmt-ignore
import { bindD1 } from "{{SCOPE}}/db/d1";
import { bindR2 } from "./bucket";
import { resolveStorageEnv } from "./env";
import { mediaRoutes, type AuthMacro } from "./media.routes";
import type { ResolveStorage, StorageContext } from "./media.service";

/**
 * What a request runs against, read from the runtime's environment when it is made: the D1 and R2
 * bindings, and `R2_PUBLIC_URL`, which a missing value fails the request that needs it, naming the
 * key, except under `wrangler dev` (and test), where it has a default. Nothing is read at import time,
 * so the API shell boots and answers `/health` without it.
 *
 * `process.env.NODE_ENV` is written out in full: wrangler replaces that expression in the bundle, by
 * `"production"` for a deploy and `"development"` for `wrangler dev`.
 */
export async function resolveRuntimeStorage(): Promise<StorageContext> {
  const env = await readRuntimeEnv();
  const { R2_PUBLIC_URL } = resolveStorageEnv(env, { nodeEnv: process.env.NODE_ENV });
  return { db: createDB(bindD1(env)), bucket: bindR2(env), publicUrl: R2_PUBLIC_URL };
}

/**
 * The media routes at `/v1/media`. The prefix is the module's, not the shell's: the `url` of every
 * stored media carries that path, and the legacy API served it under a `/v1` group the shell has not.
 */
export function mediaPlugin(resolveStorage: ResolveStorage, macro: AuthMacro = authMacro) {
  return new Elysia({ name: "media.module", prefix: "/v1" }).use(
    mediaRoutes(resolveStorage, macro),
  );
}

export const mediaModule = mediaPlugin(resolveRuntimeStorage);
