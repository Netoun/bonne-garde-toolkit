import { Elysia, t } from "elysia";
// `bonne-garde add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { clientIpHeaders, readRuntimeEnv } from "{{SCOPE}}/api-runtime";
// oxfmt-ignore
import { createDB } from "{{SCOPE}}/db";
// oxfmt-ignore
import { readLibsql } from "{{SCOPE}}/db/libsql";
import { resolveLaunchEnv, type LaunchEnv, type LaunchStage } from "./env";
import { joinWaitlist, normalizeEmail, type LaunchDatabase } from "./waitlist.service";

/** What the waiting list runs against: the settings, the database, the headers that carry the client's address, and the clock. */
export type LaunchContext = {
  env: LaunchEnv;
  db: LaunchDatabase;
  clientIpHeaders: readonly string[];
  now?: () => number;
};

/** How the routes get the context: a function, so that nothing is read at import time. */
export type ResolveLaunch = () => Promise<LaunchContext>;

/** How the macro gets the stage: the same, and it opens no database. */
export type ResolveStage = () => Promise<LaunchStage>;

/**
 * What a request runs against, read from the runtime's environment when it is made: the settings
 * (it throws on an invalid `LAUNCH_STAGE`), the libsql database `readLibsql` opens once per `DATA_DIR`,
 * and the provider's `clientIpHeaders`. Nothing is read at import time, so the API shell boots and
 * answers `/health` without it.
 */
export async function resolveRuntimeLaunch(): Promise<LaunchContext> {
  return {
    env: resolveLaunchEnv(await readRuntimeEnv()),
    db: createDB(await readLibsql()),
    clientIpHeaders,
  };
}

export async function resolveRuntimeStage(): Promise<LaunchStage> {
  return resolveLaunchEnv(await readRuntimeEnv()).LAUNCH_STAGE;
}

/** What a request with no address header is counted under: one bucket for all of them, since nothing tells them apart. */
const UNKNOWN_ADDRESS = "unknown";

function clientAddress(headers: Headers, names: readonly string[]): string {
  for (const name of names) {
    const value = headers.get(name)?.trim();
    if (value) return value;
  }
  return UNKNOWN_ADDRESS;
}

/**
 * The macro behind `{ launched: true }` on a route: 403 `{ code: "LAUNCH_WAITING" }` while the stage is
 * `waiting`, the handler once it is `launched`.
 */
export function launchMacroPlugin(resolveStage: ResolveStage) {
  return new Elysia({ name: "launch.macro" }).macro({
    launched: {
      async beforeHandle({ status }) {
        if ((await resolveStage()) === "waiting") {
          return status(403, { code: "LAUNCH_WAITING" });
        }
      },
    },
  });
}

/** `GET /launch` and `POST /launch/waitlist`, public. */
export function launchPlugin(resolveLaunch: ResolveLaunch) {
  return new Elysia({ name: "launch.routes", prefix: "/launch" })
    .get("/", async () => ({ stage: (await resolveLaunch()).env.LAUNCH_STAGE }))
    .post(
      "/waitlist",
      async ({ body, request, set, status }) => {
        const email = normalizeEmail(body.email);
        if (email === null) {
          return status(422, { code: "INVALID_EMAIL" });
        }
        const context = await resolveLaunch();
        const result = await joinWaitlist(context.db, {
          email,
          ip: clientAddress(request.headers, context.clientIpHeaders),
          maxPerHour: context.env.LAUNCH_WAITLIST_MAX_PER_HOUR,
          now: (context.now ?? Date.now)(),
        });
        if (!result.listed) {
          set.headers["retry-after"] = String(result.retryAfterSeconds);
          return status(429, { code: "WAITLIST_RATE_LIMITED" });
        }
        return { status: "listed" as const };
      },
      // Trimmed and checked in the handler: a format check here would refuse " a@x.io " before it is trimmed.
      { body: t.Object({ email: t.String() }) },
    );
}

export const launchMacro = launchMacroPlugin(resolveRuntimeStage);

export const launchModule = launchPlugin(resolveRuntimeLaunch);
