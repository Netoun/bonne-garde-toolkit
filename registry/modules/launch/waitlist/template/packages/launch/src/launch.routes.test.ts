import { count, eq } from "drizzle-orm";
import { Elysia } from "elysia";
import { describe, expect, it } from "vite-plus/test";
import { launchMacroPlugin } from "./launch.module";
import { waitlistEntry, waitlistJoin } from "./schema";
import { createTestLaunch } from "./testing";
import { HOUR_MS } from "./waitlist.service";

describe("GET /launch", () => {
  it("answers the stage the environment holds, with no session", async () => {
    const waiting = await createTestLaunch({ stage: "waiting" });
    expect(await (await waiting.get()).json()).toEqual({ stage: "waiting" });

    const launched = await createTestLaunch({ stage: "launched" });
    expect(await (await launched.get()).json()).toEqual({ stage: "launched" });
  });
});

describe("POST /launch/waitlist", () => {
  it("lists an address once, lowercased and trimmed, whatever its case", async () => {
    const { join, db } = await createTestLaunch();

    const first = await join(" A@x.io ", { ip: "10.0.0.1" });
    const second = await join("a@x.io", { ip: "10.0.0.2" });

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ status: "listed" });
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ status: "listed" });
    const rows = await db.select().from(waitlistEntry);
    expect(rows.map(({ email }) => email)).toEqual(["a@x.io"]);
    expect(rows[0]?.invitedAt).toBeNull();
  });

  it("is open whatever the stage", async () => {
    const { join } = await createTestLaunch({ stage: "launched" });
    expect((await join("a@x.io")).status).toBe(200);
  });

  it("refuses what is not an email address, and counts nothing", async () => {
    const { join, db } = await createTestLaunch();

    for (const email of ["", "   ", "not-an-email", "a@b", "a b@x.io"]) {
      expect((await join(email)).status).toBe(422);
    }
    expect(await db.select().from(waitlistEntry)).toEqual([]);
    expect(await db.select().from(waitlistJoin)).toEqual([]);
  });

  it("lets an address join 5 times an hour, then answers 429 with Retry-After", async () => {
    const { join, db, clock } = await createTestLaunch();
    for (let n = 1; n <= 5; n++) {
      expect((await join(`user${n}@x.io`, { ip: "10.0.0.1" })).status).toBe(200);
      clock.advance(60_000);
    }

    const refused = await join("user6@x.io", { ip: "10.0.0.1" });

    expect(refused.status).toBe(429);
    // The first join was 5 minutes ago: it leaves the window in 55 minutes.
    expect(refused.headers.get("retry-after")).toBe(String(55 * 60));
    expect(await refused.json()).toEqual({ code: "WAITLIST_RATE_LIMITED" });
    // A refused request is not counted, and lists nobody.
    const [joins] = await db
      .select({ n: count() })
      .from(waitlistJoin)
      .where(eq(waitlistJoin.ip, "10.0.0.1"));
    expect(joins?.n).toBe(5);
    expect(await db.select().from(waitlistEntry)).toHaveLength(5);
  });

  it("limits per address: another one still joins", async () => {
    const { join } = await createTestLaunch({ maxPerHour: 1 });
    expect((await join("a@x.io", { ip: "10.0.0.1" })).status).toBe(200);
    expect((await join("b@x.io", { ip: "10.0.0.1" })).status).toBe(429);
    expect((await join("b@x.io", { ip: "10.0.0.2" })).status).toBe(200);
  });

  it("counts a repeated address as a join: the limit is on requests, not on rows", async () => {
    const { join } = await createTestLaunch({ maxPerHour: 2 });
    expect((await join("a@x.io", { ip: "10.0.0.1" })).status).toBe(200);
    expect((await join("a@x.io", { ip: "10.0.0.1" })).status).toBe(200);
    expect((await join("a@x.io", { ip: "10.0.0.1" })).status).toBe(429);
  });

  it("lets the address join again once the hour has passed", async () => {
    const { join, clock, db } = await createTestLaunch({ maxPerHour: 1 });
    expect((await join("a@x.io", { ip: "10.0.0.1" })).status).toBe(200);
    expect((await join("b@x.io", { ip: "10.0.0.1" })).status).toBe(429);

    clock.advance(HOUR_MS);

    expect((await join("b@x.io", { ip: "10.0.0.1" })).status).toBe(200);
    // What left the window is forgotten.
    expect(await db.select().from(waitlistJoin)).toHaveLength(1);
  });

  it("reads the address from the provider's header, and puts a request without one in a bucket of its own", async () => {
    const { join } = await createTestLaunch({ maxPerHour: 1 });
    expect((await join("a@x.io", { ip: null })).status).toBe(200);
    expect((await join("b@x.io", { ip: null })).status).toBe(429);
    expect((await join("b@x.io", { ip: "10.0.0.1" })).status).toBe(200);
  });
});

describe("the launched macro", () => {
  async function guarded(stage: "waiting" | "launched") {
    const app = new Elysia()
      .use(launchMacroPlugin(async () => stage))
      .get("/open", () => "open")
      .get("/members", () => "members", { launched: true });
    return (path: string) => app.handle(new Request(`http://api.test${path}`));
  }

  it("answers 403 LAUNCH_WAITING on a guarded route while the stage is waiting", async () => {
    const get = await guarded("waiting");

    const refused = await get("/members");

    expect(refused.status).toBe(403);
    expect(await refused.json()).toEqual({ code: "LAUNCH_WAITING" });
    expect(await (await get("/open")).text()).toBe("open");
  });

  it("lets a guarded route answer once launched", async () => {
    const get = await guarded("launched");
    const answered = await get("/members");
    expect(answered.status).toBe(200);
    expect(await answered.text()).toBe("members");
  });
});
