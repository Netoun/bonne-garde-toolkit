# realtime/rooms

Rooms over WebSocket. A client opens `/realtime/<room>?ticket=<ticket>`; the ticket is signed by the
app, names the room, a subject and tags, and expires. A message published to a room reaches its peers,
or only the ones whose ticket carries one of the tags of the publish.

```bash
bunx bonne-garde add provider/dockerfile api/elysia realtime/rooms
```

This first version is the **dockerfile** provider: [crossws](https://crossws.h3.dev) behind the upgrade
seam of `{{SCOPE}}/api-runtime` (`registerUpgrade`), one instance, peers and publish in memory. The
Cloudflare variant (Durable Objects) is refused for now: `realtime/rooms accepts only dockerfile for provider`.

## Peers

| Peer       | Allow-list   | Why                                                                           |
| ---------- | ------------ | ----------------------------------------------------------------------------- |
| `provider` | `dockerfile` | `registerUpgrade` of `{{SCOPE}}/api-runtime` claims the upgrade before Elysia |
| `api`      | `elysia`     | `apps/api/src/index.ts` imports the driver, so the upgrade is registered      |

## What it writes

Everything in `packages/realtime`, plus the driver import in `apps/api/src/index.ts` and the
`REALTIME_TICKET_SECRET` line of `.env.example`.

| File                 | What it is                                                                                                      |
| -------------------- | --------------------------------------------------------------------------------------------------------------- |
| `src/protocol.ts`    | The envelope `{ v: 1, type, room, data }` (TypeBox), `encode` and `decode`, which returns null on anything else |
| `src/ticket.ts`      | `issueTicket`, `verifyTicket`, HMAC-SHA256 over Web Crypto, secret `REALTIME_TICKET_SECRET`                     |
| `src/rooms.ts`       | `defineRoom(name, { onJoin, onMessage, onLeave })` and `publishToRoom(room, message, { tags })`                 |
| `src/driver.node.ts` | The `./driver` export: the upgrade under `/realtime/`, the ping answer, the peers in memory                     |
| `src/testing.ts`     | `startTestRealtime()`: the API on a port the system picks, and clients that open a room                         |

## Use

The module ships no route that hands out tickets: who may enter a room is the app's rule. Issue one from
a route you guard:

```ts
import { issueTicket } from "{{SCOPE}}/realtime";

app.get("/v1/rooms/:room/ticket", async ({ params, user }) => ({
  // `user` comes from your auth guard: refuse here whoever may not enter the room.
  ticket: await issueTicket({
    room: params.room,
    subject: user.id,
    tags: user.role === "admin" ? ["staff"] : [],
    ttlSeconds: 60,
  }),
}));
```

Define what a room does once, at module load, and speak into it from anywhere:

```ts
import { defineRoom, publishToRoom } from "{{SCOPE}}/realtime";

defineRoom("lobby", {
  onMessage: (peer, message) =>
    publishToRoom(peer.room, { type: message.type, data: message.data }),
});
publishToRoom("lobby", { type: "notice", data: "hi" }, { tags: ["staff"] });
```

Without `tags` a publish reaches every peer; with `tags` only the peers carrying one of them, so an empty
list (`tags: []`, say a computed one) reaches nobody.

A hook keeps nothing in a closure between calls: what a peer needs is on the peer (`subject`, `tags`, from
its ticket), so the Durable Object variant can serve a room again after it hibernated.

The raw text `ping` is answered `pong` before any room sees it: the browser client's heartbeat relies on it.
`REALTIME_TICKET_SECRET` is required; the API refuses to start without it (`openssl rand -base64 32`).
Under `NODE_ENV=test` a fixture stands in. In a container, `compose.yaml` passes the project's `.env` whole.

## Limits

One instance: a second one has its own peers, so a publish reaches only the sockets of the instance that
made it. A Valkey adapter belongs behind `Transport` in `rooms.ts`, to write at the first need. Nothing is
persisted: a room's state is what its peers hold.
