/**
 * What the app writes against, the same on every provider: `defineRoom` for what a room does,
 * `publishToRoom` to speak into one from server code. A peer is what its ticket says, and the hooks
 * keep nothing of their own between calls: whatever a peer needs is on the peer, so the Durable
 * Object variant can serve a room again after it hibernated.
 */
import { encode, PROTOCOL_VERSION, type Envelope } from "./protocol";

/** A message as the app writes it: the envelope's `type` and `data`; `v` and `room` are filled in. */
export type Message = { type: string; data?: unknown };

/** A connected peer, as its ticket describes it. */
export type RoomPeer = {
  readonly id: string;
  readonly room: string;
  readonly subject: string;
  readonly tags: readonly string[];
  send(message: Message): void;
  close(code?: number, reason?: string): void;
};

export type RoomHooks = {
  onJoin?: (peer: RoomPeer) => void | Promise<void>;
  /** Only an envelope of the peer's own room reaches it; anything else is dropped before. */
  onMessage?: (peer: RoomPeer, message: Envelope) => void | Promise<void>;
  onLeave?: (peer: RoomPeer) => void | Promise<void>;
};

const rooms = new Map<string, RoomHooks>();

/** Gives the room `name` its hooks, and returns the function that takes them back. A room nobody defined has none. */
export function defineRoom(name: string, hooks: RoomHooks): () => void {
  if (rooms.has(name)) throw new Error(`The room ${name} is already defined`);
  rooms.set(name, hooks);
  return () => rooms.delete(name);
}

/** The hooks of the room `name`: those it was defined with, or none. */
export function roomHooks(name: string): RoomHooks {
  return rooms.get(name) ?? {};
}

/** The frame of `message` for `room`, as it goes down a socket. */
export function frameOf(room: string, message: Message): string {
  return encode({ v: PROTOCOL_VERSION, type: message.type, room, data: message.data ?? null });
}

/** What carries a frame to the peers of a room; the provider's driver installs it when it loads. */
export type Transport = {
  publish(room: string, frame: string, tags: readonly string[]): void;
};

let transport: Transport | undefined;

export function useTransport(next: Transport): void {
  transport = next;
}

/**
 * Sends `message` to every peer of `room`. With `tags`, only to those whose ticket carries one of them
 * (`tags: ["staff"]` reaches the staff and nobody else); without, to all.
 */
export function publishToRoom(
  room: string,
  message: Message,
  options: { tags?: readonly string[] } = {},
): void {
  if (transport === undefined) {
    throw new Error(
      "No realtime driver is loaded: apps/api/src/index.ts imports it from the realtime package",
    );
  }
  transport.publish(room, frameOf(room, message), options.tags ?? []);
}
