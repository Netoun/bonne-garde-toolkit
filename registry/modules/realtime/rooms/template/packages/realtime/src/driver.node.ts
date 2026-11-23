/**
 * The rooms on Node: crossws behind the upgrade seam of `{{SCOPE}}/api-runtime`, one instance, peers
 * kept in memory. Selected by the package's `./driver` export; `apps/api/src/index.ts` imports it so the
 * upgrade is registered. A second instance would not see the first one's peers: a shared bus belongs
 * here, behind `Transport`, the day a project runs more than one.
 */
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { registerUpgrade } from "{{SCOPE}}/api-runtime";
import type { Hooks, Peer } from "crossws";
import { decode } from "./protocol";
import { frameOf, roomHooks, useTransport, type Message, type RoomPeer } from "./rooms";
import { isTicketClaims, readTicketSecret, verifyTicket, type TicketClaims } from "./ticket";

/** The path prefix the upgrade is registered under; a socket opens `/realtime/<room>?ticket=<ticket>`. */
export const REALTIME_PREFIX = "/realtime";

// A missing secret stops the start here, not the first upgrade.
readTicketSecret();

const peersByRoom = new Map<string, Set<Peer>>();

/** The claims the upgrade verified, kept on the peer's context. */
function claimsOf(peer: Peer): TicketClaims {
  const claims: unknown = peer.context.claims;
  if (!isTicketClaims(claims)) throw new Error("A realtime peer without the claims of a ticket");
  return claims;
}

function roomPeerOf(peer: Peer): RoomPeer {
  const { room, subject, tags } = claimsOf(peer);
  return {
    id: peer.id,
    room,
    subject,
    tags,
    send: (message: Message) => peer.send(frameOf(room, message)),
    close: (code, reason) => peer.close(code, reason),
  };
}

const hooks: Partial<Hooks> = {
  async upgrade(request) {
    const url = new URL(request.url);
    let room: string;
    try {
      room = decodeURIComponent(url.pathname.slice(REALTIME_PREFIX.length + 1));
    } catch {
      return new Response("Not found", { status: 404 });
    }
    if (room === "" || room.includes("/")) return new Response("Not found", { status: 404 });
    try {
      return {
        context: { claims: await verifyTicket(url.searchParams.get("ticket") ?? "", room) },
      };
    } catch {
      return new Response("Unauthorized", { status: 401 });
    }
  },

  async open(peer) {
    const { room } = claimsOf(peer);
    const peers = peersByRoom.get(room) ?? new Set();
    peers.add(peer);
    peersByRoom.set(room, peers);
    await roomHooks(room).onJoin?.(roomPeerOf(peer));
  },

  async message(peer, message) {
    const text = message.text();
    // The client's heartbeat: answered here, never shown to a room.
    if (text === "ping") {
      peer.send("pong");
      return;
    }
    const envelope = decode(text);
    const { room } = claimsOf(peer);
    if (envelope === null || envelope.room !== room) return;
    await roomHooks(room).onMessage?.(roomPeerOf(peer), envelope);
  },

  async close(peer) {
    const { room } = claimsOf(peer);
    const peers = peersByRoom.get(room);
    peers?.delete(peer);
    if (peers?.size === 0) peersByRoom.delete(room);
    await roomHooks(room).onLeave?.(roomPeerOf(peer));
  },
};

useTransport({
  publish(room, frame, tags) {
    for (const peer of peersByRoom.get(room) ?? []) {
      if (tags === undefined || claimsOf(peer).tags.some((tag) => tags.includes(tag))) {
        peer.send(frame);
      }
    }
  },
});

/** Takes the upgrade registration back: the API stops accepting rooms. */
export const unregisterRealtime: () => void = registerUpgrade(REALTIME_PREFIX, hooks);
