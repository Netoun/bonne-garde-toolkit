/**
 * The harness the module's tests, and the project's, use: the API started in this process on a port the
 * system picks, and clients that open a room with a ticket. No stand-in for the socket or the server.
 */
// `bonne-garde add` rewrites the scope in these lines, so the formatter cannot know how wide they are.
// oxfmt-ignore
import { serve } from "{{SCOPE}}/api-runtime";
import { REALTIME_PREFIX } from "./driver.node";
import { issueTicket } from "./ticket";
import { clientOf, open, type ConnectOptions, type TestClient } from "./testing-client";

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
