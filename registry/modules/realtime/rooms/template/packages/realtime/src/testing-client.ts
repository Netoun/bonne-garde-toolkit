/**
 * The client side of the harnesses, the same on every provider: a socket that keeps what it received,
 * and what a test waits on. Plain `WebSocket`, so it runs on Node whatever serves the room.
 */
import { decode, type Envelope } from "./protocol";

export type TestClient = {
  /** The envelopes received so far, in order. */
  readonly received: readonly Envelope[];
  /** Resolves once the next envelope arrived. */
  next(): Promise<Envelope>;
  /** Sends a raw text frame. */
  send(frame: string): void;
  /**
   * Resolves once the server has handled everything sent before: it answers `ping` in order, so a
   * frame published earlier has arrived by then, and "nothing arrived" can be asserted. On Cloudflare
   * the runtime answers `ping` by itself, so only a publish that already completed (an awaited
   * `publishToRoom`, or a peer that received it) is behind the pong.
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
export function open(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.addEventListener("open", () => resolve());
    socket.addEventListener("error", () => reject(new Error("The upgrade was refused")));
  });
}

export function clientOf(socket: WebSocket): TestClient {
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
