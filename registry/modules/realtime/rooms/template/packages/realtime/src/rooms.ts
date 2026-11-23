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
  /**
   * `tags` undefined is every peer; a list is the peers carrying one of them, so an empty list is nobody.
   * A driver whose peers live in another object (Durable Objects) resolves once that object has sent.
   */
  publish(room: string, frame: string, tags: readonly string[] | undefined): void | Promise<void>;
};

let transport: Transport | undefined;

export function useTransport(next: Transport): void {
  transport = next;
}

/**
 * Sends `message` to every peer of `room`. With `tags`, only to those whose ticket carries one of them
 * (`tags: ["staff"]` reaches the staff and nobody else, `tags: []` nobody); without `tags`, to all.
 * Resolves once the frame is sent: await it where a later step relies on the peers having it.
 */
export async function publishToRoom(
  room: string,
  message: Message,
  options: { tags?: readonly string[] } = {},
): Promise<void> {
  if (transport === undefined) {
    throw new Error(
      "No realtime driver is loaded: apps/api/src/index.ts imports it from the realtime package",
    );
  }
  await transport.publish(room, frameOf(room, message), options.tags);
}

/** The state of one room, kept apart from its peers: it outlives them and the process. Values are JSON. */
export type RoomState = {
  /** `undefined` when the key is absent. */
  get(key: string): Promise<unknown>;
  /** Throws a `TypeError` for what JSON cannot hold (`undefined`, a function): delete the key instead. */
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  list(): Promise<Record<string, unknown>>;
  /** The only way a room's state goes: the last peer leaving keeps it. */
  clear(): Promise<void>;
};

/** What keeps the state of the rooms, as JSON text; the provider's driver installs it when it loads. */
export type StateStore = {
  get(room: string, key: string): Promise<string | undefined>;
  set(room: string, key: string, value: string): Promise<void>;
  delete(room: string, key: string): Promise<void>;
  list(room: string): Promise<Record<string, string>>;
  clear(room: string): Promise<void>;
};

let stateStore: StateStore | undefined;

export function useStateStore(next: StateStore): void {
  stateStore = next;
}

/**
 * The persistent state of `room`, from a hook (`roomState(peer.room)`) or from server code: a key-value
 * store of JSON values, so what `JSON.stringify` keeps is what `get` returns. Last write wins: there is no
 * update or transaction, and a `get` then a `set` across an `await` is not atomic between two hooks of the
 * same room.
 */
export function roomState(room: string): RoomState {
  const store = stateStore;
  if (store === undefined) {
    throw new Error(
      "No realtime driver is loaded: apps/api/src/index.ts imports it from the realtime package",
    );
  }
  return {
    async get(key) {
      const text = await store.get(room, key);
      return text === undefined ? undefined : (JSON.parse(text) as unknown);
    },
    async set(key, value) {
      const text = JSON.stringify(value) as string | undefined;
      if (text === undefined) {
        throw new TypeError(`The state key ${key} is not JSON: delete it to remove it`);
      }
      await store.set(room, key, text);
    },
    delete: (key) => store.delete(room, key),
    async list() {
      const entries = await store.list(room);
      return Object.fromEntries(
        Object.entries(entries).map(([key, text]) => [key, JSON.parse(text) as unknown]),
      );
    },
    clear: () => store.clear(room),
  };
}
