import { Elysia } from "elysia";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { createTestDb } from "{{SCOPE}}/db/testing";
import { launchPlugin } from "./launch.module";
import * as schema from "./schema";
import type { LaunchStage } from "./env";

/** The header a test sends the client's address in: the one `provider/dockerfile` fills. */
export const TEST_CLIENT_IP_HEADER = "x-client-ip";

/**
 * The launch routes over a fresh in-memory libsql database that has the launch tables, with a clock
 * the test moves (`clock.advance`). Nothing is mocked: the requests go through the plugin `apps/api`
 * mounts, and what it stores lands in the database the test reads back.
 */
export async function createTestLaunch(options: { stage?: LaunchStage; maxPerHour?: number } = {}) {
  const { stage = "waiting", maxPerHour = 5 } = options;
  const db = await createTestDb(schema);
  const clock = {
    time: Date.UTC(2026, 0, 1),
    advance(ms: number) {
      clock.time += ms;
    },
  };
  const app = new Elysia().use(
    launchPlugin(async () => ({
      env: { LAUNCH_STAGE: stage, LAUNCH_WAITLIST_MAX_PER_HOUR: maxPerHour },
      db,
      clientIpHeaders: [TEST_CLIENT_IP_HEADER],
      now: () => clock.time,
    })),
  );

  /** `GET /launch`. */
  function get() {
    return app.handle(new Request("http://api.test/launch"));
  }

  /** `POST /launch/waitlist` from the address `ip` (`null`: with no address header). */
  function join(email: string, { ip = "10.0.0.1" }: { ip?: string | null } = {}) {
    return app.handle(
      new Request("http://api.test/launch/waitlist", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(ip === null ? {} : { [TEST_CLIENT_IP_HEADER]: ip }),
        },
        body: JSON.stringify({ email }),
      }),
    );
  }

  return { app, db, clock, get, join };
}
