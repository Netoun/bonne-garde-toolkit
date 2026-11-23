import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";
import { issueTicket } from "./ticket";
import { defineRoom, publishToRoom } from "./rooms";
import { startTestRealtime } from "./testing";

type Realtime = Awaited<ReturnType<typeof startTestRealtime>>;

let realtime: Realtime;
let forget: Array<() => void> = [];

beforeEach(async () => {
  realtime = await startTestRealtime();
  // What a room does with a message from one of its peers: say it to the whole room.
  for (const room of ["r1", "r2"]) {
    forget.push(
      defineRoom(room, {
        onMessage: (peer, message) =>
          publishToRoom(peer.room, { type: message.type, data: message.data }),
      }),
    );
  }
});

afterEach(async () => {
  for (const undo of forget) undo();
  forget = [];
  await realtime.close();
});

describe("a room over a socket", () => {
  it("carries what one peer says to the others of its room, and to no other room", async () => {
    const a = await realtime.connect("r1");
    const b = await realtime.connect("r1");
    const c = await realtime.connect("r2");

    a.send(JSON.stringify({ v: 1, type: "chat", room: "r1", data: "hello" }));

    expect(await b.next()).toEqual({ v: 1, type: "chat", room: "r1", data: "hello" });
    expect(await c.settled()).toEqual([]);
  });

  it("reaches only the peers whose ticket carries one of the tags of a tagged publish", async () => {
    const staff = await realtime.connect("r1", { tags: ["staff"] });
    const guest = await realtime.connect("r1", { tags: ["guest"] });

    publishToRoom("r1", { type: "notice", data: 1 }, { tags: ["staff"] });

    expect((await staff.settled()).map((message) => message.type)).toEqual(["notice"]);
    expect(await guest.settled()).toEqual([]);
  });

  it("reaches every peer of the room from server code, with no tag", async () => {
    const a = await realtime.connect("r1");
    const b = await realtime.connect("r1", { tags: ["staff"] });

    publishToRoom("r1", { type: "notice" });

    expect((await a.settled()).length).toBe(1);
    expect((await b.settled()).length).toBe(1);
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

  it("answers the raw text ping with pong, without reaching the room", async () => {
    const seen: string[] = [];
    forget.push(
      defineRoom("pinged", { onMessage: (_peer, message) => void seen.push(message.type) }),
    );
    const client = await realtime.connect("pinged");

    await client.settled();

    expect(seen).toEqual([]);
  });

  it("calls onJoin with the claims of the ticket and onLeave when the socket closes", async () => {
    const events: string[] = [];
    forget.push(
      defineRoom("lobby", {
        onJoin: (peer) => void events.push(`join ${peer.subject} ${peer.tags.join(",")}`),
        onLeave: (peer) => void events.push(`leave ${peer.subject}`),
      }),
    );

    const client = await realtime.connect("lobby", { subject: "u1", tags: ["staff"] });
    await client.settled();
    await client.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(events).toEqual(["join u1 staff", "leave u1"]);
  });
});

describe("the upgrade", () => {
  it("is refused without a ticket", async () => {
    await expect(realtime.connect("r1", { ticket: "" })).rejects.toThrow(/refused/);
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
