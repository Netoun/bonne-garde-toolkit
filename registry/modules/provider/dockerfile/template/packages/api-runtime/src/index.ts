/**
 * The API's provider seam, `dockerfile` variant: Elysia on Node in one container that also serves
 * the built SPA, so the API and the front share one origin. It replaces the `cloudflare` variant
 * of this package and exports the same five names, which `apps/api` and the modules import and
 * nothing else:
 * - `runtimeOptions`: the constructor options of `new Elysia(...)` that differ per provider.
 * - `readRuntimeEnv()`: the environment record, read once by `apps/api`'s config.
 * - `clientIpHeaders`: the request headers that carry the client's address, in the order to read them.
 * - `serve(app)`: what `apps/api/src/index.ts` default-exports. It starts the server (srvx's Node
 *   adapter, which WebSocket upgrades need) and resolves with it once it listens. A promise has no
 *   `fetch`, so a runtime that serves a default-exported `{ fetch }` by itself (Bun) does not start a
 *   second one.
 * - `registerUpgrade(prefix, hooks)`: claims the WebSocket upgrades under a path prefix, before the
 *   app sees them. Here it takes crossws hooks; the `cloudflare` variant takes a fetch-style handler.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve, sep } from "node:path";
import type { Hooks } from "crossws";
import { plugin as webSockets } from "crossws/server/node";
import type { ElysiaConfig } from "elysia";
import type { Server } from "srvx";
import { serve as listen } from "srvx/node";

const DEFAULT_PORT = 5172;
const DEFAULT_DATA_DIR = ".data";
// Where `react-router build` of `apps/spa` leaves the static files, from `packages/api-runtime/src`.
const DEFAULT_SPA_DIR = join(import.meta.dirname, "../../../apps/spa/build/client");

// Elysia picks its adapter by the runtime (web-standard on Node), and ahead-of-time compilation is on
// by default; `aot` is written out so that the difference with the Workers variant is on the page.
export const runtimeOptions: Pick<ElysiaConfig<"">, "aot"> = { aot: true };

/**
 * The header `serve` fills with the client's address, and so the one a rate limit can trust: it is
 * this runtime's own, and whatever a client sent under that name is dropped. `x-forwarded-for` is
 * not, because the container publishes its port and any client can send it.
 */
const CLIENT_IP_HEADER = "x-client-ip";
export const clientIpHeaders: readonly string[] = [CLIENT_IP_HEADER];

function hasCode(error: unknown, code: string): boolean {
  return error instanceof Error && "code" in error && error.code === code;
}

/**
 * The secret kept under `dataDir`, generated on the first start. It is written to a temporary file
 * and hard-linked into place: `link` fails when the target exists, so two starts at once cannot
 * produce two secrets, and a reader never sees a file that is created but still empty.
 */
async function authSecret(dataDir: string): Promise<string> {
  const path = join(dataDir, "secrets", "better-auth-secret");
  const existing = await readFile(path, "utf8").catch((error: unknown) => {
    if (hasCode(error, "ENOENT")) return "";
    throw error;
  });
  if (existing) return existing.trim();

  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporary, randomBytes(32).toString("base64url"), { mode: 0o600 });
  try {
    await link(temporary, path);
  } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
  } finally {
    await rm(temporary, { force: true });
  }
  return (await readFile(path, "utf8")).trim();
}

/**
 * `process.env`, completed for a container where the API and the SPA share one origin: the three
 * front-end URLs default from `APP_URL`, and `BETTER_AUTH_SECRET` is generated under `DATA_DIR` when
 * unset. Nothing else is invented: a key belongs to the module whose code reads it, so
 * `RESEND_API_KEY` is the email module's and `R2_PUBLIC_URL` is storage's, and this provider has
 * neither an email provider nor a bucket to stand in for.
 */
export async function readRuntimeEnv(
  source: Record<string, string | undefined> = process.env,
): Promise<Record<string, unknown>> {
  const env: Record<string, unknown> = { ...source };
  // Blank counts as unset: compose passes `""` for `${VAR:-}`.
  const fill = (key: string, value: string) => {
    if (!env[key]) env[key] = value;
  };

  const appUrl = source.APP_URL || `http://localhost:${source.PORT || DEFAULT_PORT}`;
  for (const key of ["SPA_URL", "SSR_URL", "API_URL"]) fill(key, appUrl);
  // Under NODE_ENV=test the app fills a fixture itself; generating one would write into the cwd.
  if (!env.BETTER_AUTH_SECRET && source.NODE_ENV !== "test") {
    env.BETTER_AUTH_SECRET = await authSecret(source.DATA_DIR || DEFAULT_DATA_DIR);
  }
  return env;
}

function exit() {
  process.exit(0);
}

/**
 * Node is PID 1 in the container, and the kernel applies no default action to a signal PID 1 has no
 * handler for: without this, `docker stop` waits out its 10 seconds and kills it (exit 137).
 */
function exitOnStopSignals() {
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    if (!process.listeners(signal).includes(exit)) process.on(signal, exit);
  }
}

/** The built file a request path names under `root`, or null: absent, a directory, or outside. */
async function builtFile(root: string, pathname: string): Promise<string | null> {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const path = resolve(root, `.${decoded.endsWith("/") ? `${decoded}index.html` : decoded}`);
  if (!path.startsWith(root + sep)) return null;
  try {
    return (await stat(path)).isFile() ? path : null;
  } catch {
    return null;
  }
}

/** The content type of a file the SPA build emits; anything else is sent as bytes. */
const CONTENT_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".map": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
};

async function fileResponse(path: string): Promise<Response> {
  return new Response(new Uint8Array(await readFile(path)), {
    headers: {
      "content-type": CONTENT_TYPES[extname(path).toLowerCase()] ?? "application/octet-stream",
    },
  });
}

/** A request as the server hands it over: `ip` is the socket's peer (srvx's `request.ip`). */
export type IncomingRequest = Request & { ip?: string };

/**
 * The request with `x-client-ip` set to the client's address, whatever it held before. The address is
 * the socket's. Behind a reverse proxy that is the proxy's, and every client would share one bucket, so
 * an operator whose proxy overwrites a header with the client's address names it (`TRUSTED_PROXY_HEADER`):
 * its last entry is then used, which is the one the proxy appended.
 */
function withClientIp(request: IncomingRequest, proxyHeader: string): Request {
  const headers = new Headers(request.headers);
  headers.delete(CLIENT_IP_HEADER);
  const proxied =
    proxyHeader === "" ? undefined : request.headers.get(proxyHeader)?.split(",").at(-1)?.trim();
  const address = proxied || request.ip;
  if (address) headers.set(CLIENT_IP_HEADER, address);
  // Built from its parts: the server's request is its own class, which `new Request(request)` cannot
  // copy. The body is passed on as a stream, unread.
  const reads = request.method === "GET" || request.method === "HEAD";
  // Node needs `duplex` to send a stream; the DOM types an app type-checks this file with lack it.
  const init: RequestInit & { duplex: "half" } = {
    method: request.method,
    headers,
    body: reads ? null : request.body,
    duplex: "half",
    signal: request.signal,
  };
  return new Request(request.url, init);
}

type App = { fetch: (request: Request) => Response | Promise<Response> };
type ServeOptions = { spaDir?: string; port?: number; trustedProxyHeader?: string };

/**
 * What the server answers a request with. A built file is served as is; anything else goes to the
 * app. A browser navigation the app does not know (`GET` accepting `text/html`, answered 404) gets
 * `index.html`, so client-side routes survive a reload. An API client asking for JSON keeps its 404,
 * and so does a missing asset.
 */
export function handler(
  app: App,
  options: Omit<ServeOptions, "port"> = {},
): (request: IncomingRequest) => Promise<Response> {
  const root = resolve(options.spaDir ?? DEFAULT_SPA_DIR);
  const proxyHeader = (
    options.trustedProxyHeader ??
    process.env.TRUSTED_PROXY_HEADER ??
    ""
  ).toLowerCase();
  return async (incoming) => {
    const request = withClientIp(incoming, proxyHeader);
    const isRead = request.method === "GET";
    if (isRead) {
      const file = await builtFile(root, new URL(request.url).pathname);
      if (file) return fileResponse(file);
    }

    const response = await app.fetch(request);
    if (isRead && response.status === 404 && request.headers.get("accept")?.includes("text/html")) {
      const index = await builtFile(root, "/");
      if (index) return fileResponse(index);
    }
    return response;
  };
}

const upgrades = new Map<string, Partial<Hooks>>();

/**
 * Answers the WebSocket upgrades whose path is `prefix` or under it (`/ws/echo`, `/ws/echo/abc`, not
 * `/ws/echoes`) with `hooks`, called at module load by the package that owns them. Their `upgrade`
 * hook sees the request and can refuse it. Returns the function that takes the registration back.
 */
export function registerUpgrade(prefix: string, hooks: Partial<Hooks>): () => void {
  if (upgrades.has(prefix))
    throw new Error(`An upgrade handler is already registered for ${prefix}`);
  upgrades.set(prefix, hooks);
  return () => upgrades.delete(prefix);
}

/** An upgrade no package claimed: answered 404, and never handed to the app. */
const unclaimed: Partial<Hooks> = { upgrade: () => new Response("Not found", { status: 404 }) };

function upgradeHooks(request: Request): Partial<Hooks> {
  const { pathname } = new URL(request.url);
  for (const [prefix, hooks] of upgrades) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return hooks;
  }
  return unclaimed;
}

/** The port the server listens on: the one given, else `PORT`, else 5172. */
export function listenPort(port?: number): number {
  return port ?? (Number(process.env.PORT) || DEFAULT_PORT);
}

/** Starts the server on `listenPort` and resolves with it once it listens (see the top of the file). */
export async function serve(app: App, options: ServeOptions = {}): Promise<Server> {
  exitOnStopSignals();
  const server = listen({
    port: listenPort(options.port),
    fetch: handler(app, options),
    // Upgrades reach Node's `upgrade` event, not `fetch`: crossws answers them from the registrations.
    plugins: [webSockets({ resolve: upgradeHooks })],
    // The handler above is what a stop does in a container; srvx's own would wait for open requests.
    gracefulShutdown: false,
  });
  await server.ready();
  return server;
}
