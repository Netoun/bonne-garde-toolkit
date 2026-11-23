# realtime/rooms

Rooms over WebSocket. A client opens `/realtime/<room>?ticket=<ticket>`; the ticket is signed by the
app, names the room, a subject and tags, and expires. A message published to a room reaches its peers,
or only the ones whose ticket carries one of the tags of the publish.

```bash
bunx bonne-garde add provider/cloudflare api/elysia realtime/rooms   # or provider/dockerfile
```

One module, a driver per provider behind the package's `./driver` export, both reached through the upgrade
seam of `{{SCOPE}}/api-runtime` (`registerUpgrade`):

| Provider     | Driver                                                                                                                   |
| ------------ | ------------------------------------------------------------------------------------------------------------------------ |
| `dockerfile` | [crossws](https://crossws.h3.dev), one instance, peers and publish in memory                                             |
| `cloudflare` | One Durable Object per room (`RealtimeRoom`, `idFromName(room)`) on the hibernation API, SQLite-backed class, no crossws |

## Peers

| Peer       | Allow-list                 | Why                                                                           |
| ---------- | -------------------------- | ----------------------------------------------------------------------------- |
| `provider` | `cloudflare`, `dockerfile` | `registerUpgrade` of `{{SCOPE}}/api-runtime` claims the upgrade before Elysia |
| `api`      | `elysia`                   | `apps/api/src/index.ts` loads the driver, so the upgrade is registered        |

## What it writes

Everything in `packages/realtime`, plus the driver in `apps/api/src/index.ts` and the
`REALTIME_TICKET_SECRET` line of `.env.example`. On `cloudflare`, `apps/api/src/index.ts` also
re-exports `RealtimeRoom` (Workers bind a Durable Object class from the entry), and `apps/api/wrangler.jsonc`
gets the `REALTIME_ROOM` binding and a `new_sqlite_classes` migration (`realtime-rooms-v1`), in the default
environment and in `production`. A project that already has `migrations` in `wrangler.jsonc` merges the entry by hand.

| File                            | What it is                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `src/protocol.ts`               | The envelope `{ v: 1, type, room, data }` (TypeBox), `encode` and `decode`, which returns null on anything else                 |
| `src/ticket.ts`                 | `issueTicket`, `verifyTicket`, HMAC-SHA256 over Web Crypto, secret `REALTIME_TICKET_SECRET`                                     |
| `src/rooms.ts`                  | `defineRoom(name, { onJoin, onMessage, onLeave })` and `publishToRoom(room, message, { tags })`                                 |
| `src/client.ts`                 | The browser client, `./client` export, no server code: `connectRoom` with backoff, heartbeat and a fresh ticket per connection  |
| `src/driver.node.ts`            | `dockerfile`: the `./driver` export, the upgrade under `/realtime/`, the ping answer, the peers in memory                       |
| `src/driver.cloudflare.ts`      | `cloudflare`: the `./driver` export, the `RealtimeRoom` object, the upgrade that forwards to it, `ping` answered by the runtime |
| `src/client.node.test.ts`       | `dockerfile`: the client against the real server, through a TCP relay that can go deaf to the server                            |
| `src/testing.node.ts`           | `dockerfile`: `startTestRealtime()`, the API on a port the system picks, and clients that open a room                           |
| `src/testing.cloudflare.ts`     | `cloudflare`: `startTestRealtime({ entry })`, a Worker entry bundled and run in workerd by Miniflare, and the same clients      |
| `src/test-worker.cloudflare.ts` | `cloudflare`: the entry of the module's own tests; yours defines your rooms the same way                                        |

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

Open the room from the browser with the client (`./client`, nothing server-side in it, so `apps/spa` imports it
once it lists `"{{SCOPE}}/realtime": "workspace:*"` in its dependencies): it asks `getTicket` before **every** connection, since a ticket expires, and comes back by itself after a drop.

```ts
import { connectRoom } from "{{SCOPE}}/realtime/client";

const room = connectRoom({
  url: "wss://api.example.com/realtime", // the API's address, `/realtime` included
  room: "lobby",
  getTicket: async () => (await api.v1.rooms({ room: "lobby" }).ticket.get()).data.ticket,
  onMessage: (message) => console.log(message.type, message.data),
  onStatus: (status) => console.log(status), // connecting, open, reconnecting, closed
});
room.send({ type: "chat", data: "hello" }); // false, and dropped, while the socket is not open
room.close(); // for good: no further reconnect
```

Retries wait between half of and the full `500 ms * 2^n` (cap 30 s, back to 500 ms after a connection that held
10 s). It sends `ping` every 25 s; no `pong` within 10 s closes the socket and reconnects. A frame that is not an
envelope of version 1 is dropped before `onMessage`. A failing `getTicket` counts as a failed attempt.

Define what a room does once, at module load, and speak into it from anywhere (`publishToRoom` returns a promise,
which resolves once the frame is sent: await it where a later step relies on the peers having it):

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
its ticket), so the Durable Object variant can serve a room again after it hibernated: the claims are the
attachment of the socket, read back on every frame.

The raw text `ping` is answered `pong` before any room sees it: the browser client's heartbeat relies on it.
`REALTIME_TICKET_SECRET` is required (`openssl rand -base64 32`). Under `NODE_ENV=test` a fixture stands in.
On `dockerfile` the API refuses to start without it, and `compose.yaml` passes the project's `.env` whole. On
`cloudflare` the first upgrade fails without it: put it in `.dev.vars` for `wrangler dev` and run
`wrangler secret put REALTIME_TICKET_SECRET` when deployed.

## Tests on Workers

Rooms are defined in the Worker, which workerd runs apart from the test, so a test of yours writes a Worker
entry beside it (see `test-worker.cloudflare.ts`) and hands it to `startTestRealtime({ entry })`. The harness
bundles it with `vite-plus/pack`, **replaces Elysia's Cloudflare adapter by an empty one in that bundle**
(Miniflare refuses its dynamic `import()`, and a test never reads what the adapter configures), and serves it.
`publish()` runs `publishToRoom` inside workerd. On Cloudflare the runtime answers `ping` itself, so
`settled()` only orders what a completed publish already sent.

## Limits

`dockerfile`: one instance; a second one has its own peers, so a publish reaches only the sockets of the instance
that made it. A Valkey adapter belongs behind `Transport` in `rooms.ts`, to write at the first need. Nothing is
persisted: a room's state is what its peers hold.

`cloudflare`: a Durable Object accepts at most 10 tags per socket, and an attachment holds 2 KiB, so a ticket
carries a few short tags. A server-side `publishToRoom` is a call to the room's object, one per room.
