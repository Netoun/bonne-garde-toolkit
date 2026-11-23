import { randomBytes } from "node:crypto";
import { request as httpRequest } from "node:http";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { startTestRealtime } from "./testing.cloudflare";
import { issueTicket } from "./ticket";

type Realtime = Awaited<ReturnType<typeof startTestRealtime>>;

let realtime: Realtime;

// One workerd for the file; a Durable Object keeps its state after a test, so each test names its own room.
beforeAll(async () => {
  realtime = await startTestRealtime({
    entry: join(dirname(fileURLToPath(import.meta.url)), "test-worker.cloudflare.ts"),
  });
}, 60_000);

afterAll(() => realtime.close());

describe("a room over a socket", () => {
  it("carries what one peer says to the others of its room, and to no other room", async () => {
    const a = await realtime.connect("r1");
    const b = await realtime.connect("r1");
    const c = await realtime.connect("r2");

    a.send(JSON.stringify({ v: 1, type: "chat", room: "r1", data: "hello" }));

    expect(await b.next()).toEqual({ v: 1, type: "chat", room: "r1", data: "hello" });
    expect(await c.settled()).toEqual([]);
  });

  it("reaches every peer of the room from server code, with no tag", async () => {
    const a = await realtime.connect("r1");
    const b = await realtime.connect("r1", { tags: ["staff"] });
    const c = await realtime.connect("r2");

    await realtime.publish("r1", { type: "notice", data: "all" });

    const notice = { v: 1, type: "notice", room: "r1", data: "all" };
    expect(await a.settled()).toEqual([notice]);
    expect(await b.settled()).toEqual([notice]);
    expect(await c.settled()).toEqual([]);
  });

  it("reaches only the peers whose ticket carries one of the tags of a tagged publish", async () => {
    const staff = await realtime.connect("r1", { tags: ["staff", "ops"] });
    const guest = await realtime.connect("r1", { tags: ["guest"] });

    await realtime.publish("r1", { type: "notice", data: 1 }, { tags: ["staff", "ops"] });

    // A peer with both tags gets the frame once, not once per tag.
    expect((await staff.settled()).map((message) => message.type)).toEqual(["notice"]);
    expect(await guest.settled()).toEqual([]);
  });

  it("reaches nobody when the tags of a publish are an empty list", async () => {
    const staff = await realtime.connect("r1", { tags: ["staff"] });
    const untagged = await realtime.connect("r1");

    await realtime.publish("r1", { type: "notice" }, { tags: [] });

    expect(await staff.settled()).toEqual([]);
    expect(await untagged.settled()).toEqual([]);
  });

  it("drops a frame that is not an envelope of the peer's own room", async () => {
    const a = await realtime.connect("r1");
    const b = await realtime.connect("r1");

    for (const frame of [
      "not json",
      JSON.stringify({ v: 2, type: "chat", room: "r1", data: 1 }),
      JSON.stringify({ v: 1, type: "chat", room: "r2", data: 1 }),
    ]) {
      a.send(frame);
    }

    expect(await a.settled()).toEqual([]);
    expect(await b.settled()).toEqual([]);
  });

  it("answers the raw text ping with pong", async () => {
    const client = await realtime.connect("r1");

    await expect(client.settled()).resolves.toEqual([]);
  });
});

describe("hibernation", () => {
  it("serves a peer again from its attachment: a new instance of the object reads its claims and tags", async () => {
    const a = await realtime.connect("hibernated", { subject: "u1", tags: ["staff", "ops"] });
    const b = await realtime.connect("hibernated", { subject: "u2" });
    await Promise.all([a.settled(), b.settled()]);

    const { seen, tags } = await realtime.rehydrated("hibernated");

    expect(seen).toHaveLength(2);
    expect(seen).toContainEqual({ subject: "u1", tags: ["staff", "ops"] });
    expect(seen).toContainEqual({ subject: "u2", tags: [] });
    expect(tags).toContainEqual(["staff", "ops"]);
    expect(tags).toContainEqual([]);
  });
});

describe("the upgrade", () => {
  it("is refused without a ticket", async () => {
    await expect(realtime.connect("r1", { ticket: "" })).rejects.toThrow(/refused/);
  });

  it("is answered 404, not dropped, when the room in the path is not valid percent-encoding", async () => {
    const url = realtime.url("r1", "x");
    url.pathname = "/realtime/%E0%A4%A";
    url.protocol = "http:";

    const status = await new Promise<number>((resolve, reject) => {
      const request = httpRequest(url.href, {
        headers: {
          connection: "Upgrade",
          upgrade: "websocket",
          "sec-websocket-version": "13",
          "sec-websocket-key": randomBytes(16).toString("base64"),
        },
      });
      request.on("response", (response) => {
        response.resume();
        resolve(response.statusCode ?? 0);
      });
      request.on("error", reject);
      request.end();
    });

    expect(status).toBe(404);
  });

  it("is refused with a ticket that is tampered, expired or for another room", async () => {
    const good = await issueTicket({ room: "r1", subject: "u1", ttlSeconds: 60 });
    const expired = await issueTicket({ room: "r1", subject: "u1", ttlSeconds: 60, now: 0 });
    const other = await issueTicket({ room: "r2", subject: "u1", ttlSeconds: 60 });

    for (const ticket of [`${good.slice(0, -2)}AA`, expired, other]) {
      await expect(realtime.connect("r1", { ticket })).rejects.toThrow(/refused/);
    }
  });
});
