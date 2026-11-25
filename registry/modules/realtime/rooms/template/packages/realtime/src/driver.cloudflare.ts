/**
 * The rooms on Workers: one Durable Object per room on the hibernation API. The upgrade is claimed in
 * the seam of `{{SCOPE}}/api-runtime` (`registerUpgrade`) before the app, so Elysia never sees it: it
 * verifies the ticket, then forwards the request to the room's object. Selected by the package's
 * `./driver` export; `apps/api/src/index.ts` re-exports `RealtimeRoom` from it, which Workers need to
 * bind the class and which registers the upgrade. Nothing here imports Elysia.
 *
 * A hibernating object is evicted from memory while its sockets stay open, then built again on the next
 * frame: a peer is therefore never kept in a field or a closure. Its ticket claims are the attachment
 * of its socket and its tags are the runtime's, and both are read back on every frame.
 *
 * The state of the room (`roomState`) is the object's own SQLite storage, one table of JSON text: it is
 * on disk, so it outlives the object's eviction and a deploy. Every caller, a hook included, reaches it
 * through the room's stub, so there is one path and no state on the peer.
 */
/// <reference types="@cloudflare/workers-types" />
import { DurableObject, env } from "cloudflare:workers";
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { registerUpgrade } from "{{SCOPE}}/api-runtime";
import { REALTIME_PREFIX, ROOM_BINDING } from "./names.cloudflare";
import { decode } from "./protocol";
import {
  frameOf,
  roomHooks,
  useStateStore,
  useTransport,
  type Message,
  type RoomPeer,
} from "./rooms";
import { isTicketClaims, verifyTicket, type TicketClaims } from "./ticket";

/** The header the Worker forwards the verified claims in. A client's own copy is overwritten there. */
const CLAIMS_HEADER = "x-realtime-claims";

/** What a socket carries across hibernation: who it is, from its ticket. */
type Attachment = { id: string; claims: TicketClaims };

function isAttachment(value: unknown): value is Attachment {
  return (
    typeof value === "object" &&
    value !== null &&
    "id" in value &&
    typeof value.id === "string" &&
    "claims" in value &&
    isTicketClaims(value.claims)
  );
}

/** The peer behind a socket, read from its attachment: all the state a peer has. */
function peerOf(ws: WebSocket): RoomPeer {
  const attachment: unknown = ws.deserializeAttachment();
  if (!isAttachment(attachment))
    throw new Error("A realtime socket without the claims of a ticket");
  const { room, subject, tags } = attachment.claims;
  return {
    id: attachment.id,
    room,
    subject,
    tags,
    send: (message: Message) => ws.send(frameOf(room, message)),
    close: (code, reason) => ws.close(code, reason),
  };
}

export class RealtimeRoom extends DurableObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // Answered by the runtime, without waking the object: the client's heartbeat costs it nothing.
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    // The object is the room, so the table needs no room column; no migration, the class is SQLite-backed.
    ctx.storage.sql.exec(
      "create table if not exists room_state (key text primary key, value text not null)",
    );
  }

  /** The upgrade the Worker forwarded, with the claims it verified. */
  override async fetch(request: Request): Promise<Response> {
    const claims: unknown = JSON.parse(request.headers.get(CLAIMS_HEADER) ?? "null");
    if (!isTicketClaims(claims)) return new Response("Unauthorized", { status: 401 });
    const { 0: client, 1: server } = new WebSocketPair();
    const attachment: Attachment = { id: crypto.randomUUID(), claims };
    this.ctx.acceptWebSocket(server, [...claims.tags]);
    server.serializeAttachment(attachment);
    await roomHooks(claims.room).onJoin?.(peerOf(server));
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const peer = peerOf(ws);
    const envelope = typeof message === "string" ? decode(message) : null;
    if (envelope === null || envelope.room !== peer.room) return;
    await roomHooks(peer.room).onMessage?.(peer, envelope);
  }

  override async webSocketClose(ws: WebSocket, code: number): Promise<void> {
    // Without this answer the client waits for the closing handshake until the object is evicted.
    ws.close(code === 1005 ? 1000 : code);
    await this.webSocketError(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    const peer = peerOf(ws);
    await roomHooks(peer.room).onLeave?.(peer);
  }

  /** Sends `frame` to the sockets of this room; `tags` as in `Transport.publish`. */
  publish(frame: string, tags: readonly string[] | undefined): void {
    const sockets =
      tags === undefined
        ? this.ctx.getWebSockets()
        : new Set(tags.flatMap((tag) => this.ctx.getWebSockets(tag)));
    for (const ws of sockets) ws.send(frame);
  }

  /** The state of this room, as JSON text: the `StateStore` of `rooms.ts` with the room taken out. */
  stateGet(key: string): string | undefined {
    const rows = this.ctx.storage.sql.exec<{ value: string }>(
      "select value from room_state where key = ?",
      key,
    );
    return rows.toArray()[0]?.value;
  }

  stateSet(key: string, value: string): void {
    this.ctx.storage.sql.exec(
      "insert into room_state (key, value) values (?, ?) on conflict (key) do update set value = excluded.value",
      key,
      value,
    );
  }

  stateDelete(key: string): void {
    this.ctx.storage.sql.exec("delete from room_state where key = ?", key);
  }

  stateList(): Record<string, string> {
    const rows = this.ctx.storage.sql.exec<{ key: string; value: string }>(
      "select key, value from room_state",
    );
    return Object.fromEntries(rows.toArray().map((row) => [row.key, row.value]));
  }

  stateClear(): void {
    this.ctx.storage.sql.exec("delete from room_state");
  }
}

/** The room's object: `idFromName`, so every Worker instance reaches the same one. */
function roomStub(bindings: unknown, room: string) {
  const namespace =
    typeof bindings === "object" && bindings !== null ? Reflect.get(bindings, ROOM_BINDING) : null;
  if (!isRoomNamespace(namespace)) {
    throw new Error(`The ${ROOM_BINDING} Durable Object binding is missing from wrangler.jsonc`);
  }
  return namespace.get(namespace.idFromName(room));
}

function isRoomNamespace(value: unknown): value is DurableObjectNamespace<RealtimeRoom> {
  return typeof value === "object" && value !== null && "idFromName" in value;
}

/** The room of a request path under the prefix, or null when it is not a valid one. */
function roomOf(pathname: string): string | null {
  let room: string;
  try {
    room = decodeURIComponent(pathname.slice(REALTIME_PREFIX.length + 1));
  } catch {
    return null;
  }
  return room === "" || room.includes("/") ? null : room;
}

registerUpgrade(REALTIME_PREFIX, async (request, bindings) => {
  const url = new URL(request.url);
  const room = roomOf(url.pathname);
  if (room === null) return new Response("Not found", { status: 404 });
  let claims: TicketClaims;
  try {
    claims = await verifyTicket(url.searchParams.get("ticket") ?? "", room);
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  const forwarded = new Request(request);
  forwarded.headers.set(CLAIMS_HEADER, JSON.stringify(claims));
  return roomStub(bindings, room).fetch(forwarded);
});

useTransport({
  // A server-side publish cannot reach the sockets from here: they belong to the room's object.
  publish: (room, frame, tags) => roomStub(env, room).publish(frame, tags && [...tags]),
});

useStateStore({
  get: (room, key) => roomStub(env, room).stateGet(key),
  set: (room, key, value) => roomStub(env, room).stateSet(key, value),
  delete: (room, key) => roomStub(env, room).stateDelete(key),
  list: (room) => roomStub(env, room).stateList(),
  clear: (room) => roomStub(env, room).stateClear(),
});
