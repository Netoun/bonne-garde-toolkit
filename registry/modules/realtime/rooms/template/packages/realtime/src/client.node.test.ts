import { connect, createServer, type Server, type Socket } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import {
  backoffCeiling,
  BACKOFF_CAP_MS,
  connectRoom,
  PING_INTERVAL_MS,
  PONG_TIMEOUT_MS,
  type RoomConnection,
  type RoomStatus,
} from "./client";
import type { Envelope } from "./protocol";
import { defineRoom, publishToRoom, type RoomPeer } from "./rooms";
import { issueTicket } from "./ticket";
import { startTestRealtime } from "./testing.node";

/**
 * The client runs against the real server of the harness, through a TCP relay the test owns: the relay
 * can go deaf to the server (no `pong` reaches the client) and can slip a frame of its own into the
 * stream (a server that sends what no room would). Timers are fake, sockets are real: what the client
 * waits on is advanced by hand, what the network does is awaited.
 */
type Relay = {
  port: number;
  /** From now on, what the server sends on the connections open now never reaches the client. */
  muteServer(): void;
  /** Writes one unmasked text frame to every client. */
  inject(text: string): void;
  close(): Promise<void>;
};

/** The harness listens on every address (its URL reads `[::]`): the relay reaches it on loopback. */
async function relayTo(target: URL): Promise<Relay> {
  const pairs: Array<{ client: Socket; upstream: Socket; muted: boolean }> = [];
  const server: Server = createServer((client) => {
    const upstream = connect(Number(target.port), "127.0.0.1");
    const pair = { client, upstream, muted: false };
    pairs.push(pair);
    client.on("data", (chunk) => upstream.write(chunk));
    upstream.on("data", (chunk) => {
      if (!pair.muted) client.write(chunk);
    });
    for (const [a, b] of [
      [client, upstream],
      [upstream, client],
    ] as const) {
      a.on("close", () => b.destroy());
      a.on("error", () => b.destroy());
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("The relay has no port");
  return {
    port: address.port,
    muteServer() {
      for (const pair of pairs) pair.muted = true;
    },
    inject(text) {
      const payload = Buffer.from(text);
      if (payload.length > 125) throw new Error("Short frames only");
      for (const pair of pairs) {
        pair.client.write(Buffer.concat([Buffer.from([0x81, payload.length]), payload]));
      }
    },
    async close() {
      for (const pair of pairs) {
        pair.client.destroy();
        pair.upstream.destroy();
      }
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

type Realtime = Awaited<ReturnType<typeof startTestRealtime>>;

let realtime: Realtime;
let relay: Relay;
let endpoint: string;
let forget: Array<() => void> = [];
let connections: RoomConnection[] = [];
let peers: RoomPeer[] = [];
let tickets = 0;
let statuses: RoomStatus[] = [];
let messages: Envelope[] = [];

beforeEach(async () => {
  realtime = await startTestRealtime();
  relay = await relayTo(realtime.url("r1", "unused"));
  endpoint = `ws://127.0.0.1:${relay.port}/realtime`;
  tickets = 0;
  statuses = [];
  messages = [];
  peers = [];
  forget.push(defineRoom("r1", { onJoin: (peer) => void peers.push(peer) }));
  // Sockets and the server are real: only what the client waits on is faked.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"] });
});

afterEach(async () => {
  for (const connection of connections) connection.close();
  connections = [];
  vi.useRealTimers();
  for (const undo of forget) undo();
  forget = [];
  await relay.close();
  await realtime.close();
});

function join(room = "r1", getTicket?: () => Promise<string>): RoomConnection {
  const connection = connectRoom({
    url: endpoint,
    room,
    getTicket:
      getTicket ??
      (async () => {
        tickets += 1;
        return issueTicket({ room, subject: "subject", ttlSeconds: 60 });
      }),
    onMessage: (envelope) => void messages.push(envelope),
    onStatus: (status) => void statuses.push(status),
  });
  connections.push(connection);
  return connection;
}

const lastStatus = (status: RoomStatus) => until(() => expect(statuses.at(-1)).toBe(status));
/**
 * The server has the peer AND the client read the handshake answer. The server side alone is not
 * enough: a frame the relay slips in, or a socket it mutes, before the client read the 101 breaks the
 * handshake and sends the client into a reconnect.
 */
async function connected(count = 1): Promise<void> {
  await until(() => expect(peers.length).toBe(count));
  await lastStatus("open");
}
// The network takes real time that the fake clock does not count. `vi.waitFor` is not for this: under
// fake timers it advances the clock itself, which is what these tests must keep in their own hands.
const realSetTimeout = globalThis.setTimeout;
const realPause = (ms: number) => new Promise((resolve) => realSetTimeout(resolve, ms));
async function until(check: () => void, timeoutMs = 4000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return check();
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await realPause(5);
    }
  }
}

describe("connectRoom", () => {
  it("receives what is published to its room, and reports connecting then open", async () => {
    join();
    await connected();

    await publishToRoom("r1", { type: "notice", data: "hi" });

    await until(() => expect(messages).toEqual([{ v: 1, type: "notice", room: "r1", data: "hi" }]));
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("sends an envelope of its room to the server", async () => {
    const received: Envelope[] = [];
    forget.push(defineRoom("r2", { onMessage: (_peer, message) => void received.push(message) }));
    const connection = join("r2");
    await lastStatus("open");

    expect(connection.send({ type: "chat", data: "hello" })).toBe(true);

    await until(() =>
      expect(received).toEqual([{ v: 1, type: "chat", room: "r2", data: "hello" }]),
    );
  });

  it("refuses to send while the socket is not open", () => {
    const connection = join();
    expect(connection.send({ type: "chat" })).toBe(false);
  });

  it("reconnects with a new ticket after the server closes the socket, within the backoff bounds", async () => {
    join();
    await connected();
    expect(tickets).toBe(1);

    peers[0]?.close();
    await lastStatus("reconnecting");

    // The first retry waits between half of the base delay and the base delay (500 ms).
    await vi.advanceTimersByTimeAsync(249);
    expect(tickets).toBe(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(tickets).toBe(2);
    await connected(2);
    expect(statuses).toEqual(["connecting", "open", "reconnecting", "open"]);
  });

  it("waits twice as long after each failed attempt, up to the cap", async () => {
    expect([0, 1, 2, 3].map(backoffCeiling)).toEqual([500, 1000, 2000, 4000]);
    expect(backoffCeiling(20)).toBe(BACKOFF_CAP_MS);

    // A ticket that cannot be had fails the attempt: the next wait is twice as long.
    let asked = 0;
    join("r1", async () => {
      asked += 1;
      throw new Error("no ticket");
    });
    await lastStatus("reconnecting");
    // The first wait is between 250 and 500 ms, the second between 500 ms and 1 s.
    await vi.advanceTimersByTimeAsync(249);
    expect(asked).toBe(1);
    await vi.advanceTimersByTimeAsync(251);
    expect(asked).toBe(2);
    await vi.advanceTimersByTimeAsync(249);
    expect(asked).toBe(2);
    await vi.advanceTimersByTimeAsync(751);
    expect(asked).toBe(3);
  });

  it("closes a socket whose pings go unanswered and reconnects, 25 s + 10 s after the last sign of life", async () => {
    join();
    await connected();

    relay.muteServer();
    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS + PONG_TIMEOUT_MS - 1);
    expect(tickets).toBe(1);
    expect(statuses.at(-1)).toBe("open");

    await vi.advanceTimersByTimeAsync(1);
    expect(statuses.at(-1)).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(500);
    expect(tickets).toBe(2);
    await connected(2);
  });

  it("keeps a socket whose pings are answered", async () => {
    join();
    await connected();

    await vi.advanceTimersByTimeAsync(PING_INTERVAL_MS);
    await realPause(100);
    await vi.advanceTimersByTimeAsync(PONG_TIMEOUT_MS + 500);

    expect(tickets).toBe(1);
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("stops reconnecting once closed", async () => {
    const connection = join();
    await connected();
    peers[0]?.close();
    await lastStatus("reconnecting");

    connection.close();
    await vi.advanceTimersByTimeAsync(60_000);

    expect(tickets).toBe(1);
    expect(peers.length).toBe(1);
    expect(statuses.at(-1)).toBe("closed");
    expect(connection.status).toBe("closed");
  });

  it("never hands an invalid envelope to onMessage", async () => {
    join();
    await connected();

    for (const frame of [
      "not json",
      JSON.stringify({ v: 2, type: "notice", room: "r1", data: 1 }),
      JSON.stringify({ v: 1, type: "", room: "r1", data: 1 }),
      JSON.stringify({ type: "notice" }),
    ]) {
      relay.inject(frame);
    }
    await publishToRoom("r1", { type: "valid" });

    await until(() => expect(messages.map((message) => message.type)).toEqual(["valid"]));
  });
});
