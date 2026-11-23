/**
 * The harness the module's tests, and the project's, use: the API started in this process on a port the
 * system picks, and clients that open a room with a ticket. No stand-in for the socket or the server.
 */
// `bonne-garde add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { serve } from "{{SCOPE}}/api-runtime";
import { decode, type Envelope } from "./protocol";
import { REALTIME_PREFIX } from "./driver.node";
import { issueTicket } from "./ticket";

export type TestClient = {
  /** The envelopes received so far, in order. */
  readonly received: readonly Envelope[];
  /** Resolves once the next envelope arrived. */
  next(): Promise<Envelope>;
  /** Sends a raw text frame. */
  send(frame: string): void;
  /**
   * Resolves once the server has handled everything sent before: it answers `ping` in order, so a
   * frame published earlier has arrived by then, and "nothing arrived" can be asserted.
   */
  settled(): Promise<readonly Envelope[]>;
  close(): Promise<void>;
};

export type ConnectOptions = {
  subject?: string;
  tags?: readonly string[];
  /** The ticket to present, instead of one issued for this room. */
  ticket?: string;
};

/** Resolves once the socket is open, rejects when the upgrade is refused. */
function open(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("The upgrade was refused")));
  });
}

function clientOf(socket: WebSocket): TestClient {
  const received: Envelope[] = [];
  const waiting: Array<(envelope: Envelope) => void> = [];
  const pongs: Array<() => void> = [];
  socket.addEventListener("message", ({ data }) => {
    if (data === "pong") return pongs.shift()?.();
    const envelope = typeof data === "string" ? decode(data) : null;
    if (envelope === null) return;
    received.push(envelope);
    waiting.shift()?.(envelope);
  });
  return {
    received,
    next: () => new Promise((resolve) => waiting.push(resolve)),
    send: (frame) => socket.send(frame),
    settled: () =>
      new Promise((resolve) => {
        pongs.push(() => resolve(received));
        socket.send("ping");
      }),
    close: () =>
      new Promise((resolve) => {
        if (socket.readyState === WebSocket.CLOSED) return resolve();
        socket.addEventListener("close", () => resolve());
        socket.close();
      }),
  };
}

/** Starts the API, an app that answers 404, beside the rooms. */
export async function startTestRealtime() {
  const server = await serve(
    { fetch: () => new Response("Not found", { status: 404 }) },
    { port: 0 },
  );
  const clients = new Set<TestClient>();

  function url(room: string, ticket: string): URL {
    const target = new URL(`${REALTIME_PREFIX}/${encodeURIComponent(room)}`, server.url);
    target.protocol = "ws:";
    target.searchParams.set("ticket", ticket);
    return target;
  }

  return {
    /** The address of the room's socket with `ticket`, for a test that opens it by hand. */
    url,
    /** Opens `room` with a ticket for `options.subject` and `options.tags`; rejects when the upgrade is refused. */
    async connect(room: string, options: ConnectOptions = {}): Promise<TestClient> {
      const ticket =
        options.ticket ??
        (await issueTicket({
          room,
          subject: options.subject ?? "subject",
          tags: options.tags,
          ttlSeconds: 60,
        }));
      const socket = new WebSocket(url(room, ticket));
      await open(socket);
      const client = clientOf(socket);
      clients.add(client);
      return client;
    },
    async close() {
      await Promise.all([...clients].map((client) => client.close()));
      await server.close(true);
    },
  };
}
