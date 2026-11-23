/**
 * The browser side of the rooms, the same on every provider and free of server code, so `apps/spa`
 * can import it: a socket that opens a room with a fresh ticket and comes back after a drop. Backoff
 * with jitter between attempts, a `ping` every 25 s that the server must answer `pong` within 10 s.
 */
import { decode, encode, PROTOCOL_VERSION, type Envelope } from "./protocol";
import type { Message } from "./rooms";

export type RoomStatus = "connecting" | "open" | "reconnecting" | "closed";

export type ConnectRoomOptions = {
  /** The realtime endpoint of the API, `wss://api.example.com/realtime`; an `https:` address works too. */
  url: string | URL;
  room: string;
  /** Asked before each connection, the first and every retry: a ticket expires. A rejection counts as a failed attempt. */
  getTicket: () => string | Promise<string>;
  /** Every valid envelope of the room; a frame that is not one is dropped before. */
  onMessage: (envelope: Envelope) => void;
  onStatus?: (status: RoomStatus) => void;
};

export type RoomConnection = {
  readonly status: RoomStatus;
  /** Sends `message` to the room; false when the socket is not open, nothing is queued. */
  send(message: Message): boolean;
  /** Closes the socket and stops reconnecting, for good. */
  close(): void;
};

/** The first retry waits about this long; each one after doubles it. */
export const BACKOFF_BASE_MS = 500;
export const BACKOFF_CAP_MS = 30_000;
export const PING_INTERVAL_MS = 25_000;
export const PONG_TIMEOUT_MS = 10_000;
/** A connection that stayed open this long starts the backoff over. */
export const STABLE_AFTER_MS = 10_000;

/** The longest wait before retry number `attempt` (from 0); the wait itself is in the upper half of it. */
export function backoffCeiling(attempt: number): number {
  return Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** attempt);
}

/** The socket address of `room`: `<url>/<room>?ticket=<ticket>`, over `ws:` or `wss:`. */
function addressOf(url: string | URL, room: string, ticket: string): URL {
  const target = new URL(url);
  target.pathname = `${target.pathname.replace(/\/$/, "")}/${encodeURIComponent(room)}`;
  target.protocol = target.protocol === "https:" || target.protocol === "wss:" ? "wss:" : "ws:";
  target.searchParams.set("ticket", ticket);
  return target;
}

export function connectRoom(options: ConnectRoomOptions): RoomConnection {
  let status: RoomStatus | undefined;
  let socket: WebSocket | undefined;
  let closed = false;
  let attempt = 0;
  let retryTimer: ReturnType<typeof setTimeout> | undefined;
  let pingTimer: ReturnType<typeof setInterval> | undefined;
  let pongTimer: ReturnType<typeof setTimeout> | undefined;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;

  function setStatus(next: RoomStatus) {
    if (next === status) return;
    status = next;
    options.onStatus?.(next);
  }

  /** Stops what belongs to the current socket, and lets go of it: its events are ignored from now on. */
  function release() {
    clearTimeout(retryTimer);
    clearInterval(pingTimer);
    clearTimeout(pongTimer);
    pongTimer = undefined;
    clearTimeout(stableTimer);
    const old = socket;
    socket = undefined;
    old?.close();
  }

  /** The connection is gone, or never came: wait, then try again. */
  function lost() {
    release();
    if (closed) return;
    setStatus("reconnecting");
    const ceiling = backoffCeiling(attempt++);
    retryTimer = setTimeout(() => void connect(), ceiling / 2 + (Math.random() * ceiling) / 2);
  }

  function heartbeat(ws: WebSocket) {
    pingTimer = setInterval(() => {
      ws.send("ping");
      pongTimer ??= setTimeout(lost, PONG_TIMEOUT_MS);
    }, PING_INTERVAL_MS);
  }

  async function connect() {
    let ticket: string;
    try {
      ticket = await options.getTicket();
    } catch {
      if (!closed) lost();
      return;
    }
    if (closed) return;

    const ws = new WebSocket(addressOf(options.url, options.room, ticket).href);
    socket = ws;
    ws.addEventListener("open", () => {
      if (socket !== ws) return;
      setStatus("open");
      heartbeat(ws);
      stableTimer = setTimeout(() => (attempt = 0), STABLE_AFTER_MS);
    });
    ws.addEventListener("message", ({ data }) => {
      if (socket !== ws || typeof data !== "string") return;
      if (data === "pong") {
        clearTimeout(pongTimer);
        pongTimer = undefined;
        return;
      }
      const envelope = decode(data);
      if (envelope !== null) options.onMessage(envelope);
    });
    // A refused or dropped socket ends with `close`, `error` included.
    ws.addEventListener("close", () => {
      if (socket === ws) lost();
    });
  }

  setStatus("connecting");
  void connect();

  return {
    get status() {
      return status ?? "connecting";
    },
    send(message) {
      if (socket?.readyState !== WebSocket.OPEN) return false;
      socket.send(
        encode({
          v: PROTOCOL_VERSION,
          type: message.type,
          room: options.room,
          data: message.data ?? null,
        }),
      );
      return true;
    },
    close() {
      closed = true;
      release();
      setStatus("closed");
    },
  };
}
