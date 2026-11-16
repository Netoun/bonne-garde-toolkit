/**
 * The API's provider seam, `dockerfile` variant: Elysia on Bun in one container that also serves
 * the built SPA, so the API and the front share one origin. It replaces the `cloudflare` variant
 * of this package and exports the same four names, which `apps/api` and the modules import and
 * nothing else:
 * - `runtimeOptions`: the constructor options of `new Elysia(...)` that differ per provider.
 * - `readRuntimeEnv()`: the environment record, read once by `apps/api`'s config.
 * - `clientIpHeaders`: the request headers that carry the client's address, in the order to read them.
 * - `serve(app)`: what `apps/api/src/index.ts` default-exports. Bun serves a default-exported
 *   `{ port, fetch }` by itself when that file is the entry, so nothing here calls `listen()`:
 *   doing both would start two servers on one port.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import type { ElysiaConfig } from "elysia";

const DEFAULT_PORT = 5172;
const DEFAULT_DATA_DIR = ".data";
// Where `react-router build` of `apps/spa` leaves the static files, from `packages/api-runtime/src`.
const DEFAULT_SPA_DIR = join(import.meta.dirname, "../../../apps/spa/build/client");

// Elysia picks its Bun adapter by itself, and ahead-of-time compilation is on by default; both are
// written out only for `aot`, so that the difference with the Workers variant is on the page.
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
 * Bun is PID 1 in the container, and the kernel applies no default action to a signal PID 1 has no
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

/** What Bun hands `fetch` as its second argument, of which the runtime needs the socket's peer. */
type Peer = { requestIP(request: Request): { address: string } | null };

/**
 * The request with `x-client-ip` set to the client's address, whatever it held before. The address is
 * the socket's. Behind a reverse proxy that is the proxy's, and every client would share one bucket, so
 * an operator whose proxy overwrites a header with the client's address names it (`TRUSTED_PROXY_HEADER`):
 * its last entry is then used, which is the one the proxy appended.
 */
function withClientIp(request: Request, peer: Peer | undefined, proxyHeader: string): Request {
  // The headers of the copy are set afterwards: `new Request(request, { headers })` keeps the original
  // headers in Bun when the new ones are empty, which is the case that matters here.
  const stamped = new Request(request);
  stamped.headers.delete(CLIENT_IP_HEADER);
  const proxied =
    proxyHeader === "" ? undefined : request.headers.get(proxyHeader)?.split(",").at(-1)?.trim();
  const address = proxied || peer?.requestIP(request)?.address;
  if (address) stamped.headers.set(CLIENT_IP_HEADER, address);
  return stamped;
}

/**
 * A built file is served as is; anything else goes to the app. A browser navigation the app does
 * not know (`GET` accepting `text/html`, answered 404) gets `index.html`, so client-side routes
 * survive a reload. An API client asking for JSON keeps its 404, and so does a missing asset.
 */
export function serve(
  app: { fetch: (request: Request) => Response | Promise<Response> },
  options: { spaDir?: string; port?: number; trustedProxyHeader?: string } = {},
) {
  const root = resolve(options.spaDir ?? DEFAULT_SPA_DIR);
  const proxyHeader = (
    options.trustedProxyHeader ??
    process.env.TRUSTED_PROXY_HEADER ??
    ""
  ).toLowerCase();
  exitOnStopSignals();
  return {
    port: options.port ?? (Number(process.env.PORT) || DEFAULT_PORT),
    async fetch(incoming: Request, peer?: Peer) {
      const request = withClientIp(incoming, peer, proxyHeader);
      const isRead = request.method === "GET";
      if (isRead) {
        const file = await builtFile(root, new URL(request.url).pathname);
        if (file) return new Response(Bun.file(file));
      }

      const response = await app.fetch(request);
      if (
        isRead &&
        response.status === 404 &&
        request.headers.get("accept")?.includes("text/html")
      ) {
        const index = await builtFile(root, "/");
        if (index) return new Response(Bun.file(index));
      }
      return response;
    },
  };
}
