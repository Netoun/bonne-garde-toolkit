import { Elysia } from "elysia";
// `bonne-garde add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { readRuntimeEnv } from "{{SCOPE}}/api-runtime";
// oxfmt-ignore
import { authMacro } from "{{SCOPE}}/auth";
// oxfmt-ignore
import { createDB } from "{{SCOPE}}/db";
// oxfmt-ignore
import { readLibsql } from "{{SCOPE}}/db/libsql";
import { readBucket } from "./bucket";
import { resolveMediaSecret, resolvePublicUrl } from "./env";
import { mediaRoutes, type AuthMacro } from "./media.routes";
import type { ResolveStorage, StorageContext } from "./media.service";

/**
 * What a request runs against, read from the runtime's environment when it is made: the libsql
 * database `readLibsql` opens once per `DATA_DIR`, the directory `<DATA_DIR>/media`, and the public
 * url, derived from `APP_URL`, and the `BETTER_AUTH_SECRET` that signs the urls of private media
 * (a fixture under test). Nothing is read at import time, so the API shell boots and answers
 * `/health` without it.
 */
export async function resolveRuntimeStorage(): Promise<StorageContext> {
  const env = await readRuntimeEnv();
  return {
    db: createDB(await readLibsql()),
    bucket: await readBucket(),
    publicUrl: resolvePublicUrl(env),
    secret: resolveMediaSecret(env, { nodeEnv: process.env.NODE_ENV }),
  };
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
