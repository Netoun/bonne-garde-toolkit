/**
 * The Worker the module's tests run in workerd: the real seam (`serve`), the real driver, rooms defined
 * the way an app defines them, and the routes a test cannot reach from Node (a publish from server
 * code, the sockets of an object read back after a fresh instance of it took over).
 */
/// <reference types="@cloudflare/workers-types" />
// `bonne-garde add` rewrites the scope in this line, so the formatter cannot know how wide it is.
// oxfmt-ignore
import { serve } from "{{SCOPE}}/api-runtime";
import { RealtimeRoom as Room } from "./driver.cloudflare";
import { ROOM_BINDING } from "./names.cloudflare";
import { encode, PROTOCOL_VERSION } from "./protocol";
import { defineRoom, publishToRoom } from "./rooms";

// What a room does with a message from one of its peers: say it to the whole room.
for (const room of ["r1", "r2"]) {
  defineRoom(room, {
    onMessage: (peer, message) =>
      publishToRoom(peer.room, { type: message.type, data: message.data }),
  });
}

/** What the `hibernated` room's hook saw: the peers it was handed, as the object read them. */
const seen: Array<{ subject: string; tags: readonly string[] }> = [];
defineRoom("hibernated", {
  onMessage: (peer) => void seen.push({ subject: peer.subject, tags: peer.tags }),
});

/** The object of every room, with what only a test needs: what a new instance of it makes of its sockets. */
export class RealtimeRoom extends Room {
  /**
   * What the runtime does after a hibernation: builds the class again, over the same state, and hands
   * it a frame. The new instance has no field to read a peer from; its hook sees the claims of the
   * socket's attachment, and the runtime's tags are read beside them.
   */
  async rehydrated() {
    seen.length = 0;
    const fresh = new Room(this.ctx, this.env);
    const frame = encode({ v: PROTOCOL_VERSION, type: "probe", room: "hibernated", data: null });
    for (const ws of this.ctx.getWebSockets()) await fresh.webSocketMessage(ws, frame);
    return {
      seen: [...seen],
      tags: this.ctx.getWebSockets().map((ws) => this.ctx.getTags(ws)),
    };
  }
}

// The one assertion: `env` is what the runtime hands the Worker, and this file binds the class above.
const roomsOf = (env: unknown) =>
  Reflect.get(Object(env), ROOM_BINDING) as DurableObjectNamespace<RealtimeRoom>;

const app = {
  async fetch(request: Request, env: unknown) {
    const url = new URL(request.url);
    const room = url.searchParams.get("room") ?? "";
    if (url.pathname === "/__publish") {
      const { message, tags } = await request.json<{
        message: { type: string };
        tags?: string[];
      }>();
      await publishToRoom(room, message, { tags });
      return new Response("ok");
    }
    if (url.pathname === "/__rehydrated") {
      const namespace = roomsOf(env);
      return Response.json(await namespace.get(namespace.idFromName(room)).rehydrated());
    }
    return new Response("Not found", { status: 404 });
  },
};

export default serve(app);
