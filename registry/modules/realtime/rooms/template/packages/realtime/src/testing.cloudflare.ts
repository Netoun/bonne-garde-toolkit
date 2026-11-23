/**
 * The harness the module's tests, and the project's, use on Workers: a Worker entry bundled and run in
 * workerd by Miniflare, which is the real runtime and its real Durable Objects, and clients that open a
 * room with a ticket over a real socket. The rooms of a test are defined in the entry (workerd does
 * not share memory with the test), so the entry is the test's to write; the module's own is
 * `test-worker.cloudflare.ts`.
 */
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { build } from "vite-plus/pack";
import { REALTIME_PREFIX, ROOM_BINDING } from "./names.cloudflare";
import type { Message, RoomState } from "./rooms";
import { clientOf, open, type ConnectOptions, type TestClient } from "./testing-client";
import { issueTicket, readTicketSecret, SECRET_ENV } from "./ticket";

export type { ConnectOptions, TestClient };

/**
 * Bundles `entry` for workerd. The adapter of Elysia is replaced by an empty one: its bundle imports
 * with a dynamic specifier, which Miniflare refuses, and a test never reads what the adapter configures.
 */
async function bundle(entry: string, dir: string): Promise<string> {
  // The build empties its output directory: the adapter stays beside it.
  const outDir = join(dir, "dist");
  const adapter = join(dir, "elysia-adapter.mjs");
  await writeFile(adapter, "export const CloudflareAdapter = {};\n");
  await build({
    config: false,
    entry: { worker: entry },
    outDir,
    format: "esm",
    platform: "node",
    dts: false,
    logLevel: "silent",
    alias: { "elysia/adapter/cloudflare-worker": adapter },
    deps: { alwaysBundle: [/.*/], neverBundle: ["cloudflare:workers"] },
  });
  return join(outDir, "worker.mjs");
}

/**
 * Starts the Worker of `options.entry` in workerd, with one Durable Object per room. With
 * `options.persist`, a directory the objects keep their storage in: a test that starts workerd again over
 * the same one finds the state of its rooms, as after an eviction or a deploy. The caller owns it.
 */
export async function startTestRealtime(options: { entry: string; persist?: string }) {
  const outDir = await mkdtemp(join(tmpdir(), "realtime-"));
  const miniflare = new Miniflare({
    modules: true,
    // Module names are relative to this root: workerd refuses one that climbs out of it.
    modulesRoot: outDir,
    scriptPath: await bundle(options.entry, outDir),
    compatibilityDate: "2025-06-01",
    compatibilityFlags: ["nodejs_compat"],
    bindings: { [SECRET_ENV]: readTicketSecret() },
    durableObjects: { [ROOM_BINDING]: { className: "RealtimeRoom", useSQLite: true } },
    resourcePersistencePath: options.persist,
  });
  const origin = await miniflare.ready;
  const clients = new Set<TestClient>();

  function url(room: string, ticket: string): URL {
    const target = new URL(`${REALTIME_PREFIX}/${encodeURIComponent(room)}`, origin);
    target.protocol = "ws:";
    target.searchParams.set("ticket", ticket);
    return target;
  }

  async function post(path: string, room: string, body: unknown) {
    const response = await fetch(new URL(`${path}?room=${encodeURIComponent(room)}`, origin).href, {
      method: "POST",
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${path} answered ${response.status}`);
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
      const socket = new WebSocket(url(room, ticket).href);
      await open(socket);
      const client = clientOf(socket);
      clients.add(client);
      return client;
    },
    /** `publishToRoom` as server code runs it, inside workerd: resolves once the object has sent. */
    publish: (room: string, message: Message, publishOptions: { tags?: readonly string[] } = {}) =>
      post("/__publish", room, { message, tags: publishOptions.tags }),
    /** `roomState(room)` as server code runs it, inside workerd. */
    state(room: string): RoomState {
      async function call(body: { op: string; key?: string; value?: unknown }): Promise<unknown> {
        const response = await fetch(
          new URL(`/__state?room=${encodeURIComponent(room)}`, origin).href,
          { method: "POST", body: JSON.stringify(body) },
        );
        if (!response.ok) throw new Error(`/__state answered ${response.status}`);
        const { value } = await response.json<{ value?: unknown }>();
        return value;
      }
      return {
        get: async (key) => (await call({ op: "get", key })) ?? undefined,
        set: async (key, value) => void (await call({ op: "set", key, value })),
        delete: async (key) => void (await call({ op: "delete", key })),
        list: async () => (await call({ op: "list" })) as Record<string, unknown>,
        clear: async () => void (await call({ op: "clear" })),
      };
    },
    /** What a new instance of the room's object makes of its sockets (`test-worker.cloudflare.ts`). */
    async rehydrated(room: string): Promise<{ seen: unknown[]; tags: string[][] }> {
      const response = await fetch(
        new URL(`/__rehydrated?room=${encodeURIComponent(room)}`, origin).href,
      );
      return response.json();
    },
    async close() {
      await Promise.all([...clients].map((client) => client.close()));
      await miniflare.dispose();
      await rm(outDir, { recursive: true, force: true });
    },
  };
}
